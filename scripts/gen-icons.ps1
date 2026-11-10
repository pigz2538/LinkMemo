Add-Type -AssemblyName System.Drawing

$root = Join-Path $PSScriptRoot "..\miniprogram\assets"
$iconDir = Join-Path $root "icons"
$tabDir = Join-Path $root "tab"
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
New-Item -ItemType Directory -Force -Path $tabDir | Out-Null

$fontPath = Join-Path $PSScriptRoot "remixicon.ttf"
if (-not (Test-Path $fontPath)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $fontPath) | Out-Null
  Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/remixicon@4.5.0/fonts/remixicon.ttf" -OutFile $fontPath
}
$pfc = New-Object System.Drawing.Text.PrivateFontCollection
$pfc.AddFontFile($fontPath)
$fontFamily = $pfc.Families[0]

function New-Canvas([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)
  return @($bmp, $g)
}

function Save-Canvas($bmp, $g, [string]$path) {
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

function Get-Color([string]$name) {
  switch ($name) {
    "green"  { return [System.Drawing.ColorTranslator]::FromHtml("#2E9E5B") }
    "dark"   { return [System.Drawing.ColorTranslator]::FromHtml("#1F2A24") }
    "gray"   { return [System.Drawing.ColorTranslator]::FromHtml("#8A948D") }
    "light"  { return [System.Drawing.ColorTranslator]::FromHtml("#C9D2CC") }
    "white"  { return [System.Drawing.Color]::White }
    "red"    { return [System.Drawing.ColorTranslator]::FromHtml("#DA5A5A") }
    "amber"  { return [System.Drawing.ColorTranslator]::FromHtml("#C98124") }
    default  { return [System.Drawing.ColorTranslator]::FromHtml($name) }
  }
}

function Draw-Glyph([string]$name, [int]$glyph, [string]$color, [int]$size = 96, [single]$scale = 0.6) {
  $pair = New-Canvas $size
  $bmp = $pair[0]; $g = $pair[1]
  $brush = New-Object System.Drawing.SolidBrush((Get-Color $color))
  $font = New-Object System.Drawing.Font($fontFamily, [single]($size * $scale), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(0, 0, $size, $size)
  $g.DrawString([string][char]$glyph, $font, $brush, $rect, $fmt)
  $font.Dispose(); $brush.Dispose(); $fmt.Dispose()
  Save-Canvas $bmp $g (Join-Path $iconDir "$name-$color.png")
}

$icons = @{
  back           = 0xEA64
  chevron        = 0xEA6E
  "chevron-down" = 0xEA4E
  search         = 0xF0D1
  calendar       = 0xEB27
  sort           = 0xF15F
  tag            = 0xF023
  cloud          = 0xEB9D
  help           = 0xF045
  info           = 0xEE59
  edit           = 0xEC86
  trash          = 0xEC26
  copy           = 0xECD5
  open           = 0xECAF
  check          = 0xEB7B
  close          = 0xEB99
  plus           = 0xEA13
  clipboard      = 0xEB91
  link           = 0xEEB2
  folder         = 0xED6A
  user           = 0xF264
  doc            = 0xED0F
  image          = 0xEE4B
  mini           = 0xF2B6
  file           = 0xECC3
  text           = 0xF201
  web            = 0xEDCF
  restore        = 0xF080
  filter         = 0xED25
  logout         = 0xEEDA
  more           = 0xEF77
  "add-circle"   = 0xEA11
  "check-circle" = 0xEB81
  "arrow-right"  = 0xEA6C
  download       = 0xEC54
  sparkles       = 0xF36B
  warning        = 0xECA1
}

$colors = @{
  back = @("dark", "gray")
  chevron = @("gray", "dark")
  "chevron-down" = @("gray", "dark")
  search = @("gray", "dark")
  calendar = @("gray", "dark")
  sort = @("dark", "green")
  tag = @("dark", "green", "gray")
  cloud = @("dark", "green")
  help = @("dark")
  info = @("dark")
  edit = @("dark", "green", "white", "gray")
  trash = @("dark", "red", "white", "gray")
  copy = @("gray", "dark", "white", "green")
  open = @("gray", "dark")
  check = @("green", "white")
  close = @("gray", "dark", "white")
  plus = @("green", "white", "dark")
  clipboard = @("green", "dark", "white")
  link = @("green", "gray", "white", "dark")
  folder = @("gray", "green", "white", "dark")
  user = @("gray", "green", "white", "dark")
  doc = @("purple", "white")
  image = @("blue", "white")
  mini = @("green", "white")
  file = @("orange", "white")
  text = @("purple", "white")
  web = @("blue", "white", "gray")
  restore = @("green", "white")
  filter = @("dark", "green")
  logout = @("red")
  more = @("gray")
  "add-circle" = @("green", "white")
  "check-circle" = @("green", "white")
  "arrow-right" = @("gray")
  download = @("dark")
  sparkles = @("white", "green")
  warning = @("amber", "dark", "white")
}

foreach ($name in $icons.Keys) {
  foreach ($color in $colors[$name]) {
    Draw-Glyph $name $icons[$name] $color 96
  }
}

$tabIcons = @(
  @{ name = "collect"; glyph = 0xEEB2 },
  @{ name = "archive"; glyph = 0xED6A },
  @{ name = "mine"; glyph = 0xF264 }
)
foreach ($item in $tabIcons) {
  Draw-Glyph ("tab-" + $item.name) $item.glyph "gray" 81 0.78
  Draw-Glyph ("tab-" + $item.name) $item.glyph "green" 81 0.78
  Copy-Item (Join-Path $iconDir ("tab-" + $item.name + "-gray.png")) (Join-Path $tabDir ($item.name + ".png")) -Force
  Copy-Item (Join-Path $iconDir ("tab-" + $item.name + "-green.png")) (Join-Path $tabDir ($item.name + "-active.png")) -Force
  Remove-Item (Join-Path $iconDir ("tab-" + $item.name + "-gray.png"))
  Remove-Item (Join-Path $iconDir ("tab-" + $item.name + "-green.png"))
}

$typeIcons = @(
  @{ name = "wechat"; glyph = 0xEEB2; bg = "#E4F5EA"; fg = "#2E9E5B" },
  @{ name = "web"; glyph = 0xEDCF; bg = "#E8F1FF"; fg = "#4C8DFF" },
  @{ name = "text"; glyph = 0xED0F; bg = "#F0EAFF"; fg = "#7B61FF" },
  @{ name = "file"; glyph = 0xECC3; bg = "#FFF1E3"; fg = "#F0A03C" },
  @{ name = "image"; glyph = 0xEE4B; bg = "#E8F6FF"; fg = "#3F9FE0" },
  @{ name = "mini"; glyph = 0xF2B6; bg = "#E4F5EA"; fg = "#2E9E5B" },
  @{ name = "other"; glyph = 0xF023; bg = "#F0F2F1"; fg = "#7C8781" }
)
foreach ($t in $typeIcons) {
  $size = 96
  $pair = New-Canvas $size
  $bmp = $pair[0]; $g = $pair[1]
  $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($t.bg))
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $r = 22; $d = $r * 2
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($size - $d, 0, $d, $d, 270, 90)
  $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $path.AddArc(0, $size - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  $g.FillPath($bgBrush, $path)
  $font = New-Object System.Drawing.Font($fontFamily, [single]($size * 0.44), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($t.fg))
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString([string][char]$t.glyph, $font, $brush, (New-Object System.Drawing.RectangleF(0, 0, $size, $size)), $fmt)
  $font.Dispose(); $brush.Dispose(); $fmt.Dispose(); $bgBrush.Dispose(); $path.Dispose()
  Save-Canvas $bmp $g (Join-Path $iconDir ("type-" + $t.name + ".png"))
}

$pfc.Dispose()
Write-Output ("Generated " + (Get-ChildItem $iconDir -Filter *.png).Count + " icons in " + $iconDir)
