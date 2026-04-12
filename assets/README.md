# OpenSea Print Server — Icon Assets

## Source Files

| File              | Description                                    |
| ----------------- | ---------------------------------------------- |
| `icon.svg`        | Main app icon (256x256, blue gradient + printer)|
| `tray-icon.svg`   | System tray icon (16x16, simplified printer)   |

## Generating Platform Icons

### Prerequisites

Install ImageMagick:

- **Windows (winget):** `winget install ImageMagick.ImageMagick`
- **Windows (choco):** `choco install imagemagick`
- **macOS (brew):** `brew install imagemagick`
- **Linux (apt):** `sudo apt install imagemagick`

For macOS `.icns` on Linux, also install: `sudo apt install icnsutils`

### Run the Script

```bash
cd assets/
bash generate-icons.sh
```

### Output Files

| File              | Size(s)                        | Platform  |
| ----------------- | ------------------------------ | --------- |
| `icon.png`        | 256x256                        | All       |
| `icon.ico`        | 16, 32, 48, 64, 128, 256      | Windows   |
| `icon.icns`       | 16-512 + @2x                   | macOS     |
| `tray-icon.png`   | 16x16                          | All       |
| `tray-icon@2x.png`| 32x32                          | Retina    |

## Customizing

Edit `icon.svg` in any vector editor (Figma, Inkscape, Illustrator) and re-run the script.
The gradient colors are `#3B82F6` (blue-500) to `#4F46E5` (indigo-600).
