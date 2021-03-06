import { Component, OnInit, Inject } from '@angular/core';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { Torrent, TorrentContents } from 'src/utils/Interfaces';
import { UnitsHelperService } from '../../services/units-helper.service';
import { PrettyPrintTorrentDataService } from '../../services/pretty-print-torrent-data.service';
import { ThemeService } from '../../services/theme.service';
import { Observable } from 'rxjs';
import { TorrentDataStoreService } from '../../services/torrent-management/torrent-data-store.service';
import { NetworkConnectionInformationService } from '../../services/network/network-connection-information.service';
import { FileSystemService, SerializedNode } from '../../services/file-system/file-system.service';
import DirectoryNode from 'src/app/services/file-system/FileSystemNodes/DirectoryNode';
import { getClassForStatus, IsMobileUser } from 'src/utils/Helpers';
import { SnackbarService } from 'src/app/services/notifications/snackbar.service';

@Component({
  selector: 'app-torrent-info-dialog',
  templateUrl: './torrent-info-dialog.component.html',
  styleUrls: ['./torrent-info-dialog.component.scss']
})
export class TorrentInfoDialogComponent implements OnInit {

  public torrent: Torrent = null;
  public torrentContents: TorrentContents[] = [];
  public torrentContentsAsNodes: SerializedNode[] = [];
  
  public torrentTrackers: any[] = [];

  public isDarkTheme: Observable<boolean>;
  public isLoading = true;

  private panelsOpen: Set<string> = new Set<string>();
  private REFRESH_INTERVAL: any;

  private allowDataRefresh = true;

  public isMobileUser = IsMobileUser();

  constructor(@Inject(MAT_DIALOG_DATA) data: any, private units_helper: UnitsHelperService,
              private pp: PrettyPrintTorrentDataService, private theme: ThemeService, private data_store: TorrentDataStoreService,
              private network_info: NetworkConnectionInformationService, private fs: FileSystemService, private snackbar: SnackbarService) {
    this.torrent = data.torrent;
  }

  ngOnInit(): void {
    this.isDarkTheme = this.theme.getThemeSubscription();

    // Get data the first time immediately
    this.data_store.GetTorrentContents(this.torrent).toPromise().then(res => {this.updateTorrentContents(res)});
    this.data_store.GetTorrentTrackers(this.torrent).toPromise().then(res => { this.updateTorrentTrackers(res) })

    /** Refresh torrent contents data on the recommended interval */
    this.setRefreshInterval();
  }

  ngOnDestroy(): void {
    if(this.REFRESH_INTERVAL) { clearInterval(this.REFRESH_INTERVAL) }
  }

  private updateTorrentTrackers(trackers: any[]) { this.torrentTrackers = trackers; }

  private async updateTorrentContents(content: TorrentContents[]): Promise<void> {
    if(!this.allowDataRefresh) return;

    this.torrentContents = content;

    let intermediate_nodes = this.torrentContents.map(file => {
      return {
        index: file.index,
        name: "",
        path: file.name,
        parentPath: '',
        size: file.size,
        progress: file.progress,
        priority: file.priority,
        type: "File"
      }
    })

    // Create a file systme represented by the above nodes
    let fs_root = new DirectoryNode({ value: '', skipNameValidation: true })
    let delimiter = intermediate_nodes.length > 0 ? FileSystemService.DetectFileDelimiter(intermediate_nodes[0].path) : '/'

    await this.fs.populateFileSystemWithAdvancedOptions(intermediate_nodes as SerializedNode[], fs_root, delimiter)

    // Serialize & update
    this.torrentContentsAsNodes = await this.fs.SerializeFileSystem(fs_root);

    // Need a weighted average for total progress. 
    // Luckily qBittorrent already calculates this for us!
    this.torrentContentsAsNodes[0].progress = this.torrent.progress;

    this.isLoading = false;
  }

  handleFilePriorityChange(node: SerializedNode) {
    let newPriority = node.priority;

    // Recursively collect list of indexes that need to be changed.
    let indexes = this._filePriChangeHelper(node, []);

    // Dedupe
    indexes = [...new Set(indexes)];

    this.data_store.SetFilePriority(this.torrent, indexes, newPriority).subscribe(() => {
      this.snackbar.enqueueSnackBar("Updated file priority.");
    });
  }

  handlePriorityChangeToggled() { this.allowDataRefresh = !this.allowDataRefresh; }

  /** Recursively update list of indexes with index
   *  of each node
   */
  private _filePriChangeHelper(node: SerializedNode, indexes: any[]): any[] {
    indexes.push(node.index);

    if(node.children) {
      for (let child of node.children) {
        indexes = this._filePriChangeHelper(child, indexes);
      }
    }

    return indexes;
  }

  private setRefreshInterval() {
    this.REFRESH_INTERVAL = setInterval(() => {
      this.data_store.GetTorrentContents(this.torrent).subscribe(content => {
        this.updateTorrentContents(content);
      });

      this.data_store.GetTorrentTrackers(this.torrent).subscribe(trackers => {
        this.updateTorrentTrackers(trackers);
      })
    },
      this.network_info.get_refresh_interval_from_network_type("medium")
    );
  }

  get_content_directories_as_advanced_nodes(): SerializedNode[] { return this.torrentContentsAsNodes; }

  added_on() { return this.units_helper.GetDateString(this.torrent.added_on); }
  completed_on() { return this.pp.pretty_print_completed_on(this.torrent.completion_on); }
  last_activity() { return this.pp.pretty_print_completed_on(this.torrent.last_activity); }

  total_size() { return this.units_helper.GetFileSizeString(this.torrent.total_size); }

  downloaded() { return this.units_helper.GetFileSizeString(this.torrent.downloaded); }
  uploaded() { return this.units_helper.GetFileSizeString(this.torrent.uploaded); }

  dl_speed() { return this.units_helper.GetFileSizeString(this.torrent.dlspeed) + '/s'; }
  up_speed() { return this.units_helper.GetFileSizeString(this.torrent.upspeed) + '/s'; }
  dl_speed_avg() { return this.units_helper.GetFileSizeString(this.torrent.dl_speed_avg) + (this.torrent.dl_speed_avg ? '/s' : ''); }
  up_speed_avg() { return this.units_helper.GetFileSizeString(this.torrent.up_speed_avg) + (this.torrent.up_speed_avg ? '/s' : ''); }

  dl_limit() { return this.units_helper.GetFileSizeString(this.torrent.dl_limit) + (this.torrent.dl_limit < 0 ? '' : '/s'); }
  up_limit() { return this.units_helper.GetFileSizeString(this.torrent.up_limit) + (this.torrent.up_limit < 0 ? '' : '/s'); }

  ratio() { return Math.round(((this.torrent.ratio) + Number.EPSILON) * 100) / 100; }

  state() { return this.pp.pretty_print_status(this.torrent.state); }

  openPanel(name: string): void {
    this.panelsOpen.add(name);
  }

  closePanel(name: string): void {
    this.panelsOpen.delete(name);
  }

  isPanelOpen(name: string): boolean {
    return this.panelsOpen.has(name);
  }

  public getClassForStatus(t: Torrent): string { return getClassForStatus(t); }

}
