# Derives the Axune app icons from the source artwork so they stay reproducible.
#   powershell -NoProfile -File scripts/generate-icons.ps1
#
# Source: assets/source/axune-icon-source.png — Cedric's artwork, a rounded
# square with a bezel edge and an outer glow baked in.
#
# That baked shape must NOT ship as-is. iOS applies its own rounded mask, so
# pre-rounded artwork renders double-rounded and visibly inset. The source is
# therefore cropped INSIDE its own bezel and blown up to full bleed, letting
# Apple's mask do the shaping. Output carries no alpha channel, because Apple
# rejects App Store icons that have one.

Add-Type -AssemblyName System.Drawing

$assets = Join-Path $PSScriptRoot '../assets/images'
$source = Join-Path $PSScriptRoot '../assets/source/axune-icon-source.png'

# Fraction of the source trimmed from each edge: enough to cut the glow and the
# bezel stroke, not so much that the mark gets clipped.
$inset = 0.10

function New-Icon {
    param([int]$Size, [bool]$Opaque)

    $src = [System.Drawing.Image]::FromFile((Resolve-Path $source))
    $cropX = [int]($src.Width * $inset)
    $cropY = [int]($src.Height * $inset)
    $cropW = $src.Width - ($cropX * 2)
    $cropH = $src.Height - ($cropY * 2)

    $format = if ($Opaque) { [System.Drawing.Imaging.PixelFormat]::Format24bppRgb }
              else { [System.Drawing.Imaging.PixelFormat]::Format32bppArgb }

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size, $format)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    $dest = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $crop = New-Object System.Drawing.Rectangle($cropX, $cropY, $cropW, $cropH)
    $g.DrawImage($src, $dest, $crop, [System.Drawing.GraphicsUnit]::Pixel)

    $g.Dispose(); $src.Dispose()
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

Save-Png (New-Icon -Size 1024 -Opaque $true) 'icon.png'
Save-Png (New-Icon -Size 1024 -Opaque $true) 'adaptive-icon.png'
Save-Png (New-Icon -Size 1024 -Opaque $true) 'splash-icon.png'
Save-Png (New-Icon -Size 96 -Opaque $true) 'favicon.png'
