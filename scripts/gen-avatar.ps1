Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot "..\miniprogram\assets\images"
New-Item -ItemType Directory -Force -Path $out | Out-Null

$size = 320
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

$sky = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#DDF2FB"))
$g.FillEllipse($sky, 0, 0, $size, $size)

$cloud = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$g.FillEllipse($cloud, 36, 170, 110, 56)
$g.FillEllipse($cloud, 84, 148, 92, 76)
$g.FillEllipse($cloud, 186, 188, 104, 52)

$grass = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#8FD3A8"))
$g.FillEllipse($grass, -20, 250, 360, 130)

$white = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#FAFDFE"))
$ear = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#E9F2F6"))
$g.FillEllipse($ear, 74, 76, 74, 74)
$g.FillEllipse($ear, 172, 76, 74, 74)
$g.FillEllipse($white, 90, 88, 140, 140)
$g.FillEllipse($white, 66, 138, 188, 132)

$eye = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#2B3A33"))
$g.FillEllipse($eye, 118, 148, 18, 24)
$g.FillEllipse($eye, 184, 148, 18, 24)
$nose = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#3C4A43"))
$g.FillEllipse($nose, 148, 180, 24, 18)
$mouthPen = New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml("#3C4A43"), 4)
$g.DrawArc($mouthPen, 140, 186, 20, 18, 0, 180)
$g.DrawArc($mouthPen, 160, 186, 20, 18, 0, 180)

$scarf = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#4CB36B"))
$g.FillEllipse($scarf, 96, 226, 128, 26)
$g.FillRectangle($scarf, 196, 236, 26, 48)

$g.Dispose()
$bmp.Save((Join-Path $out "avatar-bear.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$sky.Dispose(); $cloud.Dispose(); $grass.Dispose(); $white.Dispose(); $ear.Dispose(); $eye.Dispose(); $nose.Dispose(); $mouthPen.Dispose(); $scarf.Dispose()
Write-Output "avatar generated"

