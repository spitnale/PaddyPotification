# Custom sound packs

Drop your own audio files here and they show up in the app's **Sound pack** picker,
right alongside the built-in synth chimes.

## How it works

Each folder in here is one pack. Inside a folder, name each file after the status it
should play for. The app scans this directory on load (via `/api/sounds`), so add a
folder, refresh the dashboard, and your pack appears under "Your sounds".

```
public/sounds/
  My Pack/
    alert_permission.mp3
    alert_input.mp3
    error.mp3
    waiting.mp3
    ...
```

## Status filenames

One file per status. You only need the ones you care about; any status without a
matching file falls back to the built-in synth beep, so a partial pack works fine.

| Filename (any of `.mp3 .wav .ogg .m4a .aac .flac`) | Plays when a session… |
|-----------------------------------------------------|-----------------------|
| `alert_permission`                                  | needs permission |
| `alert_input`                                       | needs your input |
| `error`                                             | hits a tool error |
| `working`                                           | starts working |
| `waiting`                                           | finishes and waits for you |
| `compacting`                                        | is compacting |
| `active`                                            | opens and goes idle |
| `ended`                                             | ends |

## Tips

- Keep clips short (under ~2 seconds) and normalized to a similar volume.
- `.mp3` and `.m4a` play everywhere, including iOS Safari. `.ogg` and `.flac` do not
  play on Apple devices, so avoid them if you open the board on your iPhone.
- Folder names can have spaces and become the label in the picker.
- These files are served publicly by the app. Only drop in audio you're fine sharing
  if you publish this repo.
