param(
    [string]$Node = 'node',
    [string]$SharpModule = 'sharp'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$OutputDirectory = $PSScriptRoot
$Utf8 = [System.Text.UTF8Encoding]::new($false)
$Invariant = [System.Globalization.CultureInfo]::InvariantCulture

function Number([double]$Value) { $Value.ToString('0.###', $Invariant) }

function Text-Outline {
    param([string]$Text, [double]$X, [double]$Y, [double]$Height,
          [string]$Color, [string]$Family = 'Microsoft YaHei', [switch]$Bold,
          [switch]$Centered)
    $FontFamily = [System.Drawing.FontFamily]::new($Family)
    $Path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $Style = if ($Bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $Path.AddString($Text, $FontFamily, [int]$Style, [single]100,
        [System.Drawing.PointF]::new(0, 0), [System.Drawing.StringFormat]::GenericTypographic)
    $Bounds = $Path.GetBounds()
    $Scale = $Height / $Bounds.Height
    $Width = $Bounds.Width * $Scale
    if ($Centered) { $X -= $Width / 2 }
    $Points = $Path.PathPoints
    $Types = $Path.PathTypes
    $Commands = [System.Collections.Generic.List[string]]::new()
    for ($Index = 0; $Index -lt $Points.Length; $Index++) {
        $Kind = $Types[$Index] -band 7
        if ($Kind -eq 0) {
            $Commands.Add(('M{0},{1}' -f (Number $Points[$Index].X), (Number $Points[$Index].Y)))
        } elseif ($Kind -eq 1) {
            $Commands.Add(('L{0},{1}' -f (Number $Points[$Index].X), (Number $Points[$Index].Y)))
        } elseif ($Kind -eq 3) {
            $Commands.Add(('C{0},{1} {2},{3} {4},{5}' -f
                (Number $Points[$Index].X), (Number $Points[$Index].Y),
                (Number $Points[$Index + 1].X), (Number $Points[$Index + 1].Y),
                (Number $Points[$Index + 2].X), (Number $Points[$Index + 2].Y)))
            $Index += 2
        }
        if (($Types[$Index] -band 128) -ne 0) { $Commands.Add('Z') }
    }
    $Data = $Commands -join ' '
    $Transform = 'translate({0} {1}) scale({2}) translate({3} {4})' -f
        (Number $X), (Number $Y), (Number $Scale), (Number (-$Bounds.X)), (Number (-$Bounds.Y))
    $Result = '<path fill="{0}" fill-rule="evenodd" transform="{1}" d="{2}"/>' -f $Color, $Transform, $Data
    $Path.Dispose()
    $FontFamily.Dispose()
    return $Result
}

$Amber = '#D99A2B'
$Ink = '#24364B'
$Muted = '#7C837F'
$Paper = '#F7F5EF'

# The same flat mark is used in all assets. Text is outlined to avoid font dependencies.
$DnsOnPaper = Text-Outline -Text 'DNS' -X 256 -Y 353 -Height 49 -Color $Ink -Family 'Segoe UI' -Bold -Centered
$Mark = @"
<rect x="8" y="8" width="496" height="496" rx="112" fill="$Amber"/>
<path d="M148 84H304L392 172V408Q392 432 368 432H148Q124 432 124 408V108Q124 84 148 84Z" fill="#FFFFFF"/>
<path d="M304 84V148Q304 172 328 172H392Z" fill="#F6E1B8"/>
<rect x="160" y="130" width="100" height="12" rx="6" fill="$Ink"/>
<rect x="160" y="232" width="38" height="62" rx="8" fill="$Amber"/>
<rect x="216" y="204" width="38" height="90" rx="8" fill="$Amber"/>
<rect x="272" y="176" width="38" height="118" rx="8" fill="$Amber"/>
<path d="M160 319H343M328 304L343 319L328 334" fill="none" stroke="$Ink" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
$DnsOnPaper
"@

$SvgStart = '<svg xmlns="http://www.w3.org/2000/svg"'
$Icon = "$SvgStart width=`"1024`" height=`"1024`" viewBox=`"0 0 512 512`" role=`"img`" aria-label=`"DNS 送货单统计应用图标`"><title>DNS · 送货单统计</title>$Mark</svg>"
[System.IO.File]::WriteAllText((Join-Path $OutputDirectory 'dns-icon.svg'), $Icon, $Utf8)

$Wordmark = Text-Outline -Text 'DNS' -X 310 -Y 33 -Height 112 -Color $Ink -Family 'Segoe UI' -Bold
$Chinese = Text-Outline -Text '送货单统计' -X 313 -Y 177 -Height 45 -Color $Ink -Bold
$Lockup = "<g transform=`"translate(0 12) scale(.5)`">$Mark</g>$Wordmark$Chinese"
$Logo = "$SvgStart width=`"1440`" height=`"560`" viewBox=`"0 0 720 280`" role=`"img`" aria-label=`"DNS 送货单统计标志`"><title>DNS · 送货单统计</title>$Lockup</svg>"
[System.IO.File]::WriteAllText((Join-Path $OutputDirectory 'dns-logo.svg'), $Logo, $Utf8)

$TopLabel = Text-Outline -Text 'DNS  /  送货单统计' -X 96 -Y 68 -Height 18 -Color $Muted -Bold
$Edition = Text-Outline -Text 'LOGO DESIGN  /  01' -X 1223 -Y 71 -Height 12 -Color $Muted -Family 'Segoe UI'
$ConceptTitle = Text-Outline -Text '送货有单，统计有数' -X 96 -Y 538 -Height 27 -Color $Ink -Bold
$ConceptCopy = Text-Outline -Text '折角单据  ·  汇总柱形  ·  送达箭头' -X 98 -Y 590 -Height 18 -Color $Muted
$AppLabel = Text-Outline -Text '应用图标' -X 120 -Y 884 -Height 16 -Color $Muted
$SmallLabel = Text-Outline -Text '小尺寸识别' -X 452 -Y 884 -Height 16 -Color $Muted
$DarkLabel = Text-Outline -Text '深色场景' -X 925 -Y 884 -Height 16 -Color '#B9C3CC'
$DarkDns = Text-Outline -Text 'DNS' -X 1068 -Y 744 -Height 55 -Color '#FFFFFF' -Family 'Segoe UI' -Bold
$DarkChinese = Text-Outline -Text '送货单统计' -X 1071 -Y 818 -Height 22 -Color '#E4E8EC' -Bold
$Preview = @"
$SvgStart width="1600" height="1000" viewBox="0 0 1600 1000" role="img" aria-label="DNS 送货单统计标志设计展示">
<title>DNS · 送货单统计标志设计展示</title>
<rect width="1600" height="1000" fill="$Paper"/>
$TopLabel$Edition
<path d="M96 118H1504" stroke="#DDDCD4"/>
<g transform="translate(348 165) scale(1.18)">$Lockup</g>
<path d="M96 492H1504" stroke="#DDDCD4"/>
$ConceptTitle$ConceptCopy
<rect x="96" y="679" width="288" height="258" rx="24" fill="#FFFFFF"/>
<g transform="translate(173 713) scale(.26)">$Mark</g>
$AppLabel
<rect x="410" y="679" width="430" height="258" rx="24" fill="#FFFFFF"/>
<g transform="translate(455 748) scale(.1875)">$Mark</g>
<g transform="translate(596 772) scale(.09375)">$Mark</g>
<g transform="translate(699 780) scale(.0625)">$Mark</g>
$SmallLabel
<rect x="866" y="679" width="638" height="258" rx="24" fill="$Ink"/>
<g transform="translate(922 739) scale(.234375)">$Mark</g>
$DarkDns$DarkChinese$DarkLabel
</svg>
"@
[System.IO.File]::WriteAllText((Join-Path $OutputDirectory 'dns-preview.svg'), $Preview, $Utf8)

$RenderCode = @'
const sharp = require(process.argv[1]);
const path = require('node:path');
const dir = process.argv[2];
(async () => {
  for (const [source, target] of [
    ['dns-icon.svg', 'dns-icon-1024.png'],
    ['dns-logo.svg', 'dns-logo.png'],
    ['dns-preview.svg', 'dns-preview.png']
  ]) {
    await sharp(path.join(dir, source)).png().toFile(path.join(dir, target));
    const meta = await sharp(path.join(dir, target)).metadata();
    console.log(JSON.stringify({file: target, width:meta.width,height:meta.height,alpha:meta.hasAlpha}));
  }
  for (const size of [48, 72, 96, 144, 192, 512]) {
    await sharp(path.join(dir, 'dns-icon.svg')).resize(size,size).png().toFile(path.join(dir,`dns-icon-${size}.png`));
  }
})().catch(error=>{console.error(error);process.exit(1)});
'@
& $Node -e $RenderCode $SharpModule $OutputDirectory
if ($LASTEXITCODE -ne 0) { throw 'SVG rasterization failed.' }

$Notes = @'
# DNS · 送货单统计 Logo

设计元素：折角单据 + 统计柱形 + 向右送达箭头 + DNS 字母。
中文全名用于完整标志，DNS 同时嵌入应用图标的单据中。
保留项目原有琥珀金，并以深蓝灰提高字母和箭头的辨识度。

- dns-preview.png：设计展示图。
- dns-logo.svg / dns-logo.png：完整标志，背景透明。
- dns-icon.svg / dns-icon-1024.png：应用图标，圆角外部透明。
- dns-icon-{48,72,96,144,192,512}.png：常用尺寸导出。

颜色：琥珀金 #D99A2B；深蓝灰 #24364B；白色 #FFFFFF。
SVG 中所有文字均已转成轮廓，无须安装字体。
图形为原创矢量绘制，没有使用图片生成 API。
已采用为正式 Logo：用于 Android 启动图标、工作台、设置页关于区域及网页版网站图标。
运行 `python android/make_icon.py`（在仓库根目录）可重新同步所有使用中的品牌图片和 Android 图标。

重新导出：在 Windows PowerShell 运行 build-logo.ps1，需 Node.js 与 sharp。
可用 -Node 和 -SharpModule 指定对应可执行文件与模块路径。
'@
[System.IO.File]::WriteAllText((Join-Path $OutputDirectory 'README.md'), $Notes, $Utf8)
