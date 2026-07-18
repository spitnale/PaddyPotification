use std::net::{Ipv6Addr, SocketAddr, TcpStream};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

const PORT: u16 = 4747;

/// Holds the Next.js server child process (if this app started it) so we can
/// shut it down cleanly when the app quits.
struct ServerHandle(Mutex<Option<Child>>);

/// Is something already listening on the dashboard port?
/// Checks BOTH loopback stacks: a server bound only to IPv4 (e.g. `next dev`)
/// must still count as "open", otherwise we'd spawn a second server that lands
/// on the free IPv6 wildcard and clients split between two stores.
fn port_open(port: u16) -> bool {
    let addrs: [SocketAddr; 2] = [
        SocketAddr::from(([127, 0, 0, 1], port)),
        SocketAddr::from((Ipv6Addr::LOCALHOST, port)),
    ];
    addrs
        .iter()
        .any(|a| TcpStream::connect_timeout(a, Duration::from_millis(300)).is_ok())
}

/// How many sessions currently need the user. Counted straight off the local
/// API with a raw HTTP/1.0 request (no chunking, connection closes at EOF) so
/// we don't need an HTTP client dependency for one integer.
#[cfg(desktop)]
fn alert_count(port: u16) -> usize {
    use std::io::{Read, Write};
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(800)) else {
        return 0;
    };
    let _ = s.set_read_timeout(Some(Duration::from_millis(1500)));
    let _ = s.set_write_timeout(Some(Duration::from_millis(800)));
    if s
        .write_all(b"GET /api/sessions HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return 0;
    }
    let mut body = String::new();
    let _ = s.take(2_000_000).read_to_string(&mut body);
    body.matches("\"status\":\"alert\"").count()
}

#[cfg(desktop)]
fn show_main<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// One-click remedy for the recurring macOS bug where the notification daemon
/// (`usernoted`) wedges and silently drops every banner — the "Paddy stopped
/// notifying" symptom. Both daemons relaunch on their own; a confirmation
/// banner fires once delivery is back so you can see it's working again.
#[cfg(target_os = "macos")]
fn restart_notifications<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri_plugin_notification::NotificationExt;
    let _ = Command::new("killall")
        .args(["usernoted", "NotificationCenter"])
        .status();
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        let _ = handle
            .notification()
            .builder()
            .title("Paddy Potification")
            .body("Notifications restarted — you're back.")
            .show();
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Launch-at-login support (desktop only).
            #[cfg(desktop)]
            {
                let _ = app.handle().plugin(tauri_plugin_autostart::init(
                    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                    None,
                ));
                // Native banners posted as this app (bundle icon), instead of
                // the dashboard shelling out to osascript (Script Editor icon).
                app.handle().plugin(tauri_plugin_notification::init())?;
            }

            app.manage(ServerHandle(Mutex::new(None)));

            // Desktop only: start the bundled Next.js server with the bundled Node
            // binary — unless a server is already running on :4747 (e.g. `npm run dev`
            // during development, in which case we just reuse it).
            #[cfg(desktop)]
            {
                if !port_open(PORT) {
                    let node = std::env::current_exe()
                        .ok()
                        .and_then(|p| p.parent().map(|d| d.join("node")));
                    let dir = app.path().resource_dir().ok().map(|d| d.join("server-bundle"));

                    match (node, dir) {
                        (Some(node), Some(dir)) => {
                            let server_js = dir.join("server.js");
                            if node.exists() && server_js.exists() {
                                match Command::new(&node)
                                    .arg(&server_js)
                                    .current_dir(&dir)
                                    .env("PORT", PORT.to_string())
                                    .env("HOSTNAME", "0.0.0.0")
                                    .env("NODE_ENV", "production")
                                    .spawn()
                                {
                                    Ok(child) => {
                                        app.state::<ServerHandle>()
                                            .0
                                            .lock()
                                            .unwrap()
                                            .replace(child);
                                    }
                                    Err(e) => eprintln!("Paddy: failed to start server: {e}"),
                                }
                            } else {
                                eprintln!(
                                    "Paddy: bundled server missing (node exists={}, server.js exists={})",
                                    node.exists(),
                                    server_js.exists()
                                );
                            }
                        }
                        _ => eprintln!("Paddy: could not resolve bundled server paths"),
                    }
                }
            }

            // Menu-bar presence: tray icon with an alert-count badge. Closing
            // the window hides it (Paddy keeps watching); Quit lives in the
            // tray menu, and Cmd+Q still quits normally.
            #[cfg(desktop)]
            {
                use tauri::menu::{MenuBuilder, MenuItemBuilder};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

                let open_i = MenuItemBuilder::with_id("open", "Open Paddy").build(app)?;
                let fix_i =
                    MenuItemBuilder::with_id("fix_notifications", "Restart notifications").build(app)?;
                let quit_i = MenuItemBuilder::with_id("quit", "Quit Paddy").build(app)?;
                let menu = MenuBuilder::new(app)
                    .items(&[&open_i, &fix_i, &quit_i])
                    .build()?;

                let mut tray = TrayIconBuilder::with_id("main-tray")
                    .tooltip("Paddy Potification")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "open" => show_main(app),
                        "fix_notifications" => {
                            #[cfg(target_os = "macos")]
                            restart_notifications(app);
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            show_main(tray.app_handle());
                        }
                    });
                // macOS menu-bar icons are template images: monochrome with
                // alpha, tinted by the system like every other status item.
                #[cfg(target_os = "macos")]
                {
                    tray = tray
                        .icon(tauri::image::Image::from_bytes(include_bytes!(
                            "../icons/tray.png"
                        ))?)
                        .icon_as_template(true);
                }
                #[cfg(not(target_os = "macos"))]
                if let Some(icon) = app.default_window_icon() {
                    tray = tray.icon(icon.clone());
                }
                tray.build(app)?;

                // Badge updater: poll the local API and put the number of
                // sessions that need attention next to the tray icon.
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let mut last: Option<usize> = None;
                    loop {
                        let count = alert_count(PORT);
                        if last != Some(count) {
                            last = Some(count);
                            let h = handle.clone();
                            let _ = handle.run_on_main_thread(move || {
                                if let Some(tray) = h.tray_by_id("main-tray") {
                                    let title = if count > 0 { Some(count.to_string()) } else { None };
                                    let tip = if count > 0 {
                                        format!("Paddy — {count} need you")
                                    } else {
                                        "Paddy Potification".to_string()
                                    };
                                    let _ = tray.set_title(title);
                                    let _ = tray.set_tooltip(Some(tip));
                                }
                            });
                        }
                        std::thread::sleep(Duration::from_secs(5));
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|_window, _event| {
            // Close = hide to tray; the board keeps running and notifying.
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                let _ = _window.hide();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                // Kill the server we spawned when the app exits.
                tauri::RunEvent::Exit => {
                    if let Some(state) = app.try_state::<ServerHandle>() {
                        if let Some(mut child) = state.0.lock().unwrap().take() {
                            let _ = child.kill();
                        }
                    }
                }
                // Dock icon clicked while the window is hidden.
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen { .. } => show_main(app),
                _ => {}
            }
        });
}
