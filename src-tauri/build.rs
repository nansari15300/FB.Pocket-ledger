// Least privilege: har app command ke liye alag `allow-<command>` permission generate hoti hai;
// capabilities (capabilities/*.json + runtime `app-content`) sirf zaroori commands allow karti hain.
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            // tab strip (local asset) — capabilities/tabstrip.json
            "tab_strip_action",
            "tab_reload_active",
            "win_chrome_action",
            "win_show_app_menu",
            "win_start_drag",
            // content tabs (http://localhost:<port>) — runtime capability `app-content`
            "pl_open_url_in_new_tab",
            "pl_tab_sync_done",
            "pl_device_display_info",
            "pl_trace_log",
            "pl_trace_get_logs",
            "pl_trace_get_log_file_path",
            "pl_shortcut",
            "pl_broadcast_db_bump",
            "pl_broadcast_gate_snapshot",
            "pl_set_remote_auth",
            "pl_print_done",
            // sirf local app-content (http://localhost:<appUiPort>) — remote origin ko nahi
            "pl_pick_directory",
            "pl_backup_write",
            "pl_backup_list",
            "pl_backup_read",
            "pl_att_write",
            "pl_att_write_binary",
            "pl_att_read",
            "pl_att_delete",
            "pl_att_exists",
            "pl_att_stat_sizes",
            "pl_local_server",
            "pl_bridge_upsert",
            "pl_update_download",
            "pl_bridge_result",
            "pl_open_external_auth",
        ]),
    ))
    .expect("failed to run tauri-build");
}
