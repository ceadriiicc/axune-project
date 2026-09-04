# Generates the Axune app icons from code so they stay reproducible.
#   powershell -NoProfile -File scripts/generate-icons.ps1
#
# Mark: a chevron "A" in white-to-silver with a violet slanted bar as the
# crossbar, on near-black. Drawn FULL BLEED with no rounded corners and no
# outer glow on purpose — iOS applies its own rounded mask, so baked-in
# corners render double-rounded and visibly inset. The iOS icon is written
# without an alpha channel because Apple rejects App Store icons carrying one.

Add-Type -AssemblyName System.Drawing

$assets = Join-Path $PSScriptRoot '../assets/images'
$bg = [System.Drawing.ColorTranslator]::FromHtml('#0A0C10')
$violet = [System.Drawing.ColorTranslator]::FromHtml('#6D3BE8')
$blue = [System.Drawing.ColorTranslator]::FromHtml('#4A6BFF')
$white = [System.Drawing.ColorTranslator]::FromHtml('#FFFFFF')
$silver = [System.Drawing.ColorTranslator]::FromHtml('#9AA3B8')

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

    if ($Opaque) { $g.Clear($bg) } else { $g.Clear([System.Drawing.Color]::Transparent) }

    # Geometry is authored against a 1024 grid, then scaled about the centre.
    $u = $Size / 1024.0
    $c = $Size / 2.0
    function P {
        param([double]$x, [double]$y)
        New-Object System.Drawing.PointF(
            [float]($c + ($x - 512) * $u * $Scale),
            [float]($c + ($y - 512) * $u * $Scale))
    }

    # Chevron A: outer apex, down the right leg, back up its inner edge to the
    # notch, then down the left leg's inner edge and up its outer edge.
    $caret = @(
        (P 512 205), (P 872 838), (P 706 838),
        (P 512 494), (P 318 838), (P 152 838)
    )

    $caretRect = New-Object System.Drawing.RectangleF(
        [float]($c - 380 * $u * $Scale), [float]($c - 320 * $u * $Scale),
        [float](760 * $u * $Scale), [float](660 * $u * $Scale))
    $caretBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $caretRect, $white, $silver, 62.0)
    $g.FillPolygon($caretBrush, [System.Drawing.PointF[]]$caret)

    # Violet crossbar: a parallelogram slanted parallel to the left leg, kept
    # inside the chevron's interior so it never breaks the outer silhouette.
    $bar = @((P 430 672), (P 628 672), (P 520 810), (P 322 810))
    $barRect = New-Object System.Drawing.RectangleF(
        [float]($c - 190 * $u * $Scale), [float]($c + 155 * $u * $Scale),
        [float](310 * $u * $Scale), [float](140 * $u * $Scale))
    $barBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $barRect, $violet, $blue, 20.0)
    $g.FillPolygon($barBrush, [System.Drawing.PointF[]]$bar)

    $caretBrush.Dispose(); $barBrush.Dispose(); $g.Dispose()
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

# iOS/base icon: opaque, full bleed, no baked corner radius.
Save-Png (New-Mark -Size 1024 -Opaque $true) 'icon.png'

# Android adaptive foreground: transparent and inset, so the system mask can crop.
Save-Png (New-Mark -Size 1024 -Opaque $false -Scale 0.60) 'adaptive-icon.png'

# Splash: transparent mark, centred on the splash backgroundColor from app.json.
Save-Png (New-Mark -Size 1024 -Opaque $false -Scale 0.72) 'splash-icon.png'

# Web favicon.
Save-Png (New-Mark -Size 96 -Opaque $true) 'favicon.png'
