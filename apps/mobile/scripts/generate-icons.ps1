# Generates the Axune app icons from code so they stay reproducible.
#   powershell -NoProfile -File scripts/generate-icons.ps1
#
# Mark: two overlapping rings — one Claude sand, one Codex teal — the shared
# centre being the point of Paired Mode. The iOS icon is written without an
# alpha channel because Apple rejects App Store icons that carry one.

Add-Type -AssemblyName System.Drawing

$assets = Join-Path $PSScriptRoot '../assets/images'
$bg = [System.Drawing.ColorTranslator]::FromHtml('#11161D')
$sand = [System.Drawing.ColorTranslator]::FromHtml('#D8AD7B')
$teal = [System.Drawing.ColorTranslator]::FromHtml('#6EB8BB')

function New-Mark {
    param(
        [int]$Size,
        [bool]$Opaque,
        [double]$Scale = 1.0
    )

    $format = if ($Opaque) { [System.Drawing.Imaging.PixelFormat]::Format24bppRgb }
              else { [System.Drawing.Imaging.PixelFormat]::Format32bppArgb }

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size, $format)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    if ($Opaque) {
        $g.Clear($bg)
    } else {
        $g.Clear([System.Drawing.Color]::Transparent)
    }

    # Geometry expressed against a 1024 grid, then scaled.
    $u = $Size / 1024.0
    $radius = 210 * $u * $Scale
    $offset = 104 * $u * $Scale
    $stroke = 74 * $u * $Scale
    $cy = $Size / 2.0
    $cx = $Size / 2.0

    $penSand = New-Object System.Drawing.Pen($sand, $stroke)
    $penTeal = New-Object System.Drawing.Pen($teal, $stroke)

    $g.DrawEllipse($penSand, [float]($cx - $offset - $radius), [float]($cy - $radius),
                   [float]($radius * 2), [float]($radius * 2))
    $g.DrawEllipse($penTeal, [float]($cx + $offset - $radius), [float]($cy - $radius),
                   [float]($radius * 2), [float]($radius * 2))

    $penSand.Dispose(); $penTeal.Dispose(); $g.Dispose()
    return $bmp
}

function Save-Png {
    param([System.Drawing.Bitmap]$Bitmap, [string]$Name)
    $path = Join-Path $assets $Name
    $size = "$($Bitmap.Width)x$($Bitmap.Height)"
    $Bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $Bitmap.Dispose()
    Write-Output "wrote $Name ($size)"
}

# iOS/base icon: opaque, full bleed.
Save-Png (New-Mark -Size 1024 -Opaque $true) 'icon.png'

# Android adaptive foreground: transparent, inset so the system mask can crop it.
Save-Png (New-Mark -Size 1024 -Opaque $false -Scale 0.62) 'adaptive-icon.png'

# Splash: transparent mark, centred on the splash backgroundColor from app.json.
Save-Png (New-Mark -Size 1024 -Opaque $false -Scale 0.78) 'splash-icon.png'

# Web favicon.
Save-Png (New-Mark -Size 96 -Opaque $true) 'favicon.png'
