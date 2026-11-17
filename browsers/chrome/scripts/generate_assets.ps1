#requires -Version 5.1
<#
.SYNOPSIS
    Generates all PNG artwork assets for the Neon Horizon Synthwave Google Chrome theme.
.DESCRIPTION
    Combines high-resolution source NTP artwork (assets/ntp_source.jpg) with procedural
    seamless Chrome UI strip textures, corner overlays, and supersampled theme icons
    into theme/images/*.png using .NET System.Drawing.
#>
[CmdletBinding()]
param(
    [string]$ChromeRoot,
    [string]$RepoRoot,
    [ValidateSet('All', 'Theme', 'Extension')]
    [string]$Target = 'All'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ChromeRoot)) {
    $ChromeRoot = Split-Path -Parent $PSScriptRoot
}
if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Split-Path -Parent (Split-Path -Parent $ChromeRoot)
}

Add-Type -AssemblyName System.Drawing

$csharpSource = @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

namespace SynthwaveAssets
{
    public struct RgbColor
    {
        public double R, G, B;
        public RgbColor(double r, double g, double b) { R = r; G = g; B = b; }

        public static RgbColor Lerp(RgbColor a, RgbColor b, double t)
        {
            t = Math.Max(0.0, Math.Min(1.0, t));
            return new RgbColor(
                a.R + (b.R - a.R) * t,
                a.G + (b.G - a.G) * t,
                a.B + (b.B - a.B) * t
            );
        }
    }

    public static class Generator
    {
        private static readonly int[,] Bayer4x4 = {
            {  0,  8,  2, 10 },
            { 12,  4, 14,  6 },
            {  3, 11,  1,  9 },
            { 15,  7, 13,  5 }
        };

        private static byte ClampByte(double v)
        {
            if (v <= 0.0) return 0;
            if (v >= 255.0) return 255;
            return (byte)(v + 0.5);
        }

        private static double SmoothStep(double edge0, double edge1, double x)
        {
            if (edge1 <= edge0) return x >= edge1 ? 1.0 : 0.0;
            double t = Math.Max(0.0, Math.Min(1.0, (x - edge0) / (edge1 - edge0)));
            return t * t * (3.0 - 2.0 * t);
        }

        private static RgbColor SampleThreeStop(RgbColor top, RgbColor mid, RgbColor bot, double midPos, double t)
        {
            if (t <= midPos)
                return RgbColor.Lerp(top, mid, midPos <= 0 ? 0 : t / midPos);
            return RgbColor.Lerp(mid, bot, midPos >= 1 ? 1 : (t - midPos) / (1.0 - midPos));
        }

        private static RgbColor SampleNeonWave(RgbColor c1, RgbColor c2, RgbColor c3, double u)
        {
            // Seamless periodic wave across u in [0, 1)
            double phase = (u - Math.Floor(u)) * 2.0 * Math.PI;
            double w1 = 0.5 + 0.5 * Math.Cos(phase);
            double w2 = 0.5 + 0.5 * Math.Sin(phase);
            RgbColor baseMix = RgbColor.Lerp(c1, c2, 1.0 - w1);
            return RgbColor.Lerp(baseMix, c3, w2 * 0.45);
        }

        private static void SavePng(Bitmap bmp, string path)
        {
            string dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                Directory.CreateDirectory(dir);
            bmp.Save(path, ImageFormat.Png);
        }

        public static void BuildUiStrip(
            string outputPath,
            int width,
            int height,
            RgbColor topColor,
            RgbColor midColor,
            RgbColor botColor,
            double midPos,
            RgbColor beamA,
            RgbColor beamB,
            RgbColor beamC,
            double beamOpacity,
            int beamGlowRows,
            double scanlineStrength,
            int starCount,
            double starIntensity,
            int seed)
        {
            BuildUiStrip(
                outputPath, width, height,
                topColor, midColor, botColor, midPos,
                beamA, beamB, beamC, beamOpacity, beamGlowRows,
                scanlineStrength, starCount, starIntensity, seed,
                0.0, 0.0, 1
            );
        }

        public static void BuildUiStrip(
            string outputPath,
            int width,
            int height,
            RgbColor topColor,
            RgbColor midColor,
            RgbColor botColor,
            double midPos,
            RgbColor beamA,
            RgbColor beamB,
            RgbColor beamC,
            double beamOpacity,
            int beamGlowRows,
            double scanlineStrength,
            int starCount,
            double starIntensity,
            int seed,
            double tabBandHeight,
            double bodyWaveStrength,
            int waveCycles)
        {
            int cycles = Math.Max(1, waveCycles);
            using (var bmp = new Bitmap(width, height, PixelFormat.Format24bppRgb))
            {
                var rect = new Rectangle(0, 0, width, height);
                var data = bmp.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
                int stride = data.Stride;
                byte[] buf = new byte[stride * height];

                // Precompute star pixels with seamless wrap
                var rng = new Random(seed);
                double[] starMask = new double[width * height];
                int[] starTint = new int[width * height];
                for (int i = 0; i < starCount; i++)
                {
                    int sx = rng.Next(width);
                    int sy = rng.Next(4, Math.Max(8, (int)(height * 0.65)));
                    double bright = (0.28 + rng.NextDouble() * 0.72) * starIntensity;
                    int kind = rng.Next(3); // 0=white-cyan, 1=cyan, 2=magenta
                    starMask[sy * width + sx] = Math.Max(starMask[sy * width + sx], bright);
                    starTint[sy * width + sx] = kind;
                    if (rng.NextDouble() < 0.25)
                    {
                        int nx = (sx + 1) % width;
                        starMask[sy * width + nx] = Math.Max(starMask[sy * width + nx], bright * 0.45);
                        starTint[sy * width + nx] = kind;
                    }
                }

                for (int y = 0; y < height; y++)
                {
                    double ty = height > 1 ? (double)y / (height - 1) : 0.0;
                    RgbColor rowBase = SampleThreeStop(topColor, midColor, botColor, midPos, ty);
                    double scanMul = (scanlineStrength > 0.0 && (y % 2 == 1)) ? (1.0 - scanlineStrength) : 1.0;

                    double beamFade = 0.0;
                    if (beamOpacity > 0.0 && y <= beamGlowRows)
                    {
                        double rimDecay = Math.Exp(-y * 0.48);
                        double rimTail = 1.0 - SmoothStep(Math.Max(1.0, beamGlowRows * 0.45), beamGlowRows + 0.5, y);
                        beamFade = beamOpacity * rimDecay * rimTail;
                    }

                    double bodyWaveFade = 0.0;
                    if (bodyWaveStrength > 0.0 && tabBandHeight > 0.0 && y < tabBandHeight)
                    {
                        double decayStart = Math.Max(4.0, tabBandHeight * 0.42);
                        bodyWaveFade = bodyWaveStrength * (1.0 - SmoothStep(decayStart, tabBandHeight, y));
                    }

                    double totalWaveMix = Math.Min(0.95, bodyWaveFade + beamFade * (1.0 - bodyWaveFade));

                    int rowOffset = y * stride;
                    for (int x = 0; x < width; x++)
                    {
                        double r = rowBase.R * scanMul;
                        double g = rowBase.G * scanMul;
                        double b = rowBase.B * scanMul;

                        if (totalWaveMix > 0.001)
                        {
                            double u = ((double)x / width) * cycles;
                            RgbColor beam = SampleNeonWave(beamA, beamB, beamC, u);
                            r = r + (beam.R - r) * totalWaveMix;
                            g = g + (beam.G - g) * totalWaveMix;
                            b = b + (beam.B - b) * totalWaveMix;
                        }

                        double st = starMask[y * width + x];
                        if (st > 0.001)
                        {
                            int kind = starTint[y * width + x];
                            RgbColor sc = kind == 1
                                ? new RgbColor(120, 245, 255)
                                : (kind == 2 ? new RgbColor(255, 130, 220) : new RgbColor(235, 242, 255));
                            r += (sc.R - r) * st;
                            g += (sc.G - g) * st;
                            b += (sc.B - b) * st;
                        }

                        // Subtle ordered dithering prevents banding on dark gradients
                        double dither = (Bayer4x4[y & 3, x & 3] / 16.0 - 0.5) * 0.9;
                        int idx = rowOffset + x * 3;
                        buf[idx + 0] = ClampByte(b + dither);
                        buf[idx + 1] = ClampByte(g + dither);
                        buf[idx + 2] = ClampByte(r + dither);
                    }
                }

                Marshal.Copy(buf, 0, data.Scan0, buf.Length);
                bmp.UnlockBits(data);
                SavePng(bmp, outputPath);
            }
        }

        public static void BuildWindowControlBackground(
            string outputPath,
            int width,
            int height,
            RgbColor topTint,
            RgbColor lowTint,
            RgbColor beamA,
            RgbColor beamB,
            RgbColor beamC,
            double activeBandHeight,
            int waveCycles)
        {
            int cycles = Math.Max(1, waveCycles);
            using (var bmp = new Bitmap(width, height, PixelFormat.Format24bppRgb))
            {
                var rect = new Rectangle(0, 0, width, height);
                var data = bmp.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
                int stride = data.Stride;
                byte[] buf = new byte[stride * height];

                for (int y = 0; y < height; y++)
                {
                    int rowOffset = y * stride;
                    if (y >= activeBandHeight)
                    {
                        // Stay fully transparent below the caption cluster so DPI tiling never repeats
                        continue;
                    }

                    double ty = y / Math.Max(1.0, activeBandHeight);
                    RgbColor vColor = RgbColor.Lerp(topTint, lowTint, ty);
                    double topRim = 0.34 * Math.Exp(-y * 0.65) * (1.0 - SmoothStep(2.0, 5.5, y));
                    double pillowAlpha = 0.44 * (1.0 - SmoothStep(10.0, activeBandHeight, y));
                    double alphaNorm = Math.Min(0.75, pillowAlpha + topRim * (1.0 - pillowAlpha));

                    if (alphaNorm <= 0.002) continue;

                    double waveMix = 0.24 + topRim * 0.55;
                    for (int x = 0; x < width; x++)
                    {
                        double u = ((double)x / width) * cycles;
                        RgbColor wave = SampleNeonWave(beamA, beamB, beamC, u);
                        double r = vColor.R + (wave.R - vColor.R) * waveMix;
                        double g = vColor.G + (wave.G - vColor.G) * waveMix;
                        double b = vColor.B + (wave.B - vColor.B) * waveMix;

                        double dither = (Bayer4x4[y & 3, x & 3] / 16.0 - 0.5) * 0.8;
                        int idx = rowOffset + x * 4;
                        buf[idx + 0] = ClampByte(b + dither);
                        buf[idx + 1] = ClampByte(g + dither);
                        buf[idx + 2] = ClampByte(r + dither);
                        buf[idx + 3] = ClampByte(alphaNorm * 255.0);
                    }
                }

                Marshal.Copy(buf, 0, data.Scan0, buf.Length);
                bmp.UnlockBits(data);
                SavePng(bmp, outputPath);
            }
        }

        public static void BuildFrameOverlay(string outputPath, int width, int height, double opacityScale)
        {
            using (var bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb))
            {
                var rect = new Rectangle(0, 0, width, height);
                var data = bmp.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                int stride = data.Stride;
                byte[] buf = new byte[stride * height];

                for (int y = 0; y < height; y++)
                {
                    double ny = (double)y / height;
                    double edgeFadeY = 1.0 - SmoothStep(0.35, 1.0, ny);
                    int rowOffset = y * stride;

                    for (int x = 0; x < width; x++)
                    {
                        double nx = (double)x / width;
                        double edgeFadeX = 1.0 - SmoothStep(0.15, 1.0, nx);

                        // Dual atmospheric glow lobes: magenta-pink near top-left + cyan prism streak
                        double d1 = Math.Sqrt(Math.Pow(nx * 1.45, 2) + Math.Pow(ny * 1.15, 2));
                        double g1 = Math.Exp(-d1 * d1 * 4.2);

                        double d2 = Math.Sqrt(Math.Pow((nx - 0.22) * 1.8, 2) + Math.Pow((ny - 0.12) * 1.6, 2));
                        double g2 = Math.Exp(-d2 * d2 * 6.5);

                        double alphaNorm = Math.Min(1.0, (g1 * 0.24 + g2 * 0.14) * edgeFadeX * edgeFadeY * opacityScale);
                        double r = (255.0 * g1 * 0.65 + 40.0 * g2 * 0.35) / Math.Max(0.001, g1 * 0.65 + g2 * 0.35);
                        double g = (42.0 * g1 * 0.65 + 235.0 * g2 * 0.35) / Math.Max(0.001, g1 * 0.65 + g2 * 0.35);
                        double b = (155.0 * g1 * 0.65 + 255.0 * g2 * 0.35) / Math.Max(0.001, g1 * 0.65 + g2 * 0.35);

                        int idx = rowOffset + x * 4;
                        buf[idx + 0] = ClampByte(b);
                        buf[idx + 1] = ClampByte(g);
                        buf[idx + 2] = ClampByte(r);
                        buf[idx + 3] = ClampByte(alphaNorm * 255.0);
                    }
                }

                Marshal.Copy(buf, 0, data.Scan0, buf.Length);
                bmp.UnlockBits(data);
                SavePng(bmp, outputPath);
            }
        }

        public static void BuildNtpWallpaper(
            string sourcePath,
            string outputPath,
            int targetWidth,
            int targetHeight,
            RgbColor ntpBaseColor,
            int seed)
        {
            using (var src = new Bitmap(sourcePath))
            using (var scaled = new Bitmap(targetWidth, targetHeight, PixelFormat.Format24bppRgb))
            {
                using (var g = Graphics.FromImage(scaled))
                {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.SmoothingMode = SmoothingMode.HighQuality;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.CompositingQuality = CompositingQuality.HighQuality;
                    g.DrawImage(src, new Rectangle(0, 0, targetWidth, targetHeight));
                }

                var rect = new Rectangle(0, 0, targetWidth, targetHeight);
                var data = scaled.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format24bppRgb);
                int stride = data.Stride;
                byte[] buf = new byte[stride * targetHeight];
                Marshal.Copy(data.Scan0, buf, 0, buf.Length);

                // Seeded crisp 1:1 native stars in the upper calm sky (avoiding the sun region)
                var rng = new Random(seed);
                double[] starMask = new double[targetWidth * targetHeight];
                int[] starKind = new int[targetWidth * targetHeight];
                double sunCx = targetWidth * 0.50;
                double sunCy = targetHeight * 0.51;
                double sunAvoidR = targetHeight * 0.25;

                for (int i = 0; i < 160; i++)
                {
                    int sx = rng.Next(40, targetWidth - 40);
                    int sy = rng.Next(45, (int)(targetHeight * 0.44));
                    double dx = sx - sunCx;
                    double dy = sy - sunCy;
                    if (dx * dx + dy * dy < sunAvoidR * sunAvoidR) continue;

                    double topFade = SmoothStep(35.0, 140.0, sy);
                    double bright = (0.20 + rng.NextDouble() * 0.65) * topFade;
                    int kind = rng.Next(4);
                    starMask[sy * targetWidth + sx] = bright;
                    starKind[sy * targetWidth + sx] = kind;

                    // Occasional subtle 4-point glint on brighter stars
                    if (bright > 0.62 && sx > 1 && sx < targetWidth - 2 && sy > 1 && sy < targetHeight - 2)
                    {
                        double arm = bright * 0.35;
                        starMask[sy * targetWidth + (sx - 1)] = Math.Max(starMask[sy * targetWidth + (sx - 1)], arm);
                        starMask[sy * targetWidth + (sx + 1)] = Math.Max(starMask[sy * targetWidth + (sx + 1)], arm);
                        starMask[(sy - 1) * targetWidth + sx] = Math.Max(starMask[(sy - 1) * targetWidth + sx], arm);
                        starMask[(sy + 1) * targetWidth + sx] = Math.Max(starMask[(sy + 1) * targetWidth + sx], arm);
                    }
                }

                for (int y = 0; y < targetHeight; y++)
                {
                    // Seamless blend into ntp_background at top edge (0..135px)
                    double keepTop = SmoothStep(0.0, 135.0, y);
                    // Subtle moire-free 6px bell-curve CRT scanline across lower horizon/grid area
                    double scanMul = 1.0;
                    if (y > targetHeight * 0.56)
                    {
                        double phase = (y % 6) / 6.0;
                        double wBell = Math.Abs(phase * 2.0 - 1.0);
                        double waveY = wBell * wBell * (3.0 - 2.0 * wBell);
                        scanMul = 1.0 - 0.032 * (1.0 - waveY);
                    }

                    int rowOffset = y * stride;
                    for (int x = 0; x < targetWidth; x++)
                    {
                        // Gentle outer left/right atmospheric edge feather (0..60px and width-60..width)
                        double keepLeft = SmoothStep(0.0, 60.0, x);
                        double keepRight = SmoothStep(0.0, 60.0, (targetWidth - 1) - x);
                        double keep = keepTop * Math.Min(keepLeft, keepRight);

                        int idx = rowOffset + x * 3;
                        double b = buf[idx + 0] * scanMul;
                        double g = buf[idx + 1] * scanMul;
                        double r = buf[idx + 2] * scanMul;

                        double st = starMask[y * targetWidth + x];
                        if (st > 0.001)
                        {
                            int kind = starKind[y * targetWidth + x];
                            RgbColor sc = kind == 0
                                ? new RgbColor(135, 248, 255)
                                : (kind == 1 ? new RgbColor(255, 165, 235) : new RgbColor(242, 245, 255));
                            r += (sc.R - r) * st;
                            g += (sc.G - g) * st;
                            b += (sc.B - b) * st;
                        }

                        // Blend seamlessly toward exact ntp_background color on outer top/left/right margins
                        r = ntpBaseColor.R + (r - ntpBaseColor.R) * keep;
                        g = ntpBaseColor.G + (g - ntpBaseColor.G) * keep;
                        b = ntpBaseColor.B + (b - ntpBaseColor.B) * keep;

                        double dither = (Bayer4x4[y & 3, x & 3] / 16.0 - 0.5) * 0.7;
                        buf[idx + 0] = ClampByte(b + dither);
                        buf[idx + 1] = ClampByte(g + dither);
                        buf[idx + 2] = ClampByte(r + dither);
                    }
                }

                Marshal.Copy(buf, 0, data.Scan0, buf.Length);
                scaled.UnlockBits(data);
                SavePng(scaled, outputPath);
            }
        }

        private static GraphicsPath CreateRoundedRect(RectangleF bounds, float radius)
        {
            var path = new GraphicsPath();
            float d = radius * 2f;
            path.AddArc(bounds.X, bounds.Y, d, d, 180, 90);
            path.AddArc(bounds.Right - d, bounds.Y, d, d, 270, 90);
            path.AddArc(bounds.Right - d, bounds.Bottom - d, d, d, 0, 90);
            path.AddArc(bounds.X, bounds.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        public static void BuildThemeIcon(string outputPath, int size)
        {
            BuildThemeIcon(outputPath, size, 18f, false);
        }

        public static void BuildThemeIcon(string outputPath, int size, float padAt512)
        {
            BuildThemeIcon(outputPath, size, padAt512, false);
        }

        public static void BuildThemeIcon(string outputPath, int size, float padAt512, bool crtShaderOverlay)
        {
            if (size <= 24)
            {
                // Pixel-crisp bespoke geometry for 16x16 / small icons
                using (var small = new Bitmap(size, size, PixelFormat.Format32bppArgb))
                using (var sg = Graphics.FromImage(small))
                {
                    sg.SmoothingMode = SmoothingMode.AntiAlias;
                    sg.Clear(Color.Transparent);

                    using (var card = CreateRoundedRect(new RectangleF(0.5f, 0.5f, size - 1f, size - 1f), size * 0.22f))
                    {
                        sg.SetClip(card);
                        using (var bg = new LinearGradientBrush(
                            new PointF(0, 0), new PointF(0, size),
                            Color.FromArgb(12, 7, 28), Color.FromArgb(32, 12, 56)))
                        {
                            sg.FillRectangle(bg, 0, 0, size, size);
                        }

                        float sunD = size * 0.62f;
                        float sunX = (size - sunD) / 2f;
                        float sunY = size * 0.16f;
                        float horY = size * 0.65f;

                        using (var sunClip = new Region(new RectangleF(0, 0, size, horY)))
                        {
                            sunClip.Intersect(card);
                            sg.Clip = sunClip;
                            using (var sunB = new LinearGradientBrush(
                                new PointF(0, sunY), new PointF(0, horY),
                                Color.FromArgb(255, 232, 95), Color.FromArgb(255, 42, 133)))
                            {
                                sg.FillEllipse(sunB, sunX, sunY, sunD, sunD);
                            }
                            using (var cutB = new SolidBrush(Color.FromArgb(20, 9, 40)))
                            {
                                sg.FillRectangle(cutB, 0, horY - 3.2f, size, 1.1f);
                                sg.FillRectangle(cutB, 0, horY - 1.4f, size, 1.1f);
                            }
                            sg.SetClip(card);
                        }

                        using (var floorB = new SolidBrush(Color.FromArgb(16, 7, 32)))
                        {
                            sg.FillRectangle(floorB, 0, horY, size, size - horY);
                        }
                        using (var hPen = new Pen(Color.FromArgb(0, 240, 255), 1.2f))
                        {
                            sg.DrawLine(hPen, 0, horY, size, horY);
                        }
                        using (var gPen = new Pen(Color.FromArgb(255, 42, 165), 1f))
                        {
                            sg.DrawLine(gPen, size * 0.35f, horY + 1f, size * 0.12f, size);
                            sg.DrawLine(gPen, size * 0.50f, horY + 1f, size * 0.50f, size);
                            sg.DrawLine(gPen, size * 0.65f, horY + 1f, size * 0.88f, size);
                            sg.DrawLine(gPen, 0, horY + 3f, size, horY + 3f);
                        }
                        sg.ResetClip();
                    }

                    using (var borderPath = CreateRoundedRect(new RectangleF(0.6f, 0.6f, size - 1.2f, size - 1.2f), size * 0.22f))
                    using (var borderBrush = new LinearGradientBrush(
                        new PointF(0, 0), new PointF(size, size),
                        Color.FromArgb(0, 240, 255), Color.FromArgb(255, 42, 133)))
                    using (var borderPen = new Pen(borderBrush, 1.1f))
                    {
                        sg.DrawPath(borderPen, borderPath);
                    }
                    SavePng(small, outputPath);
                }
                return;
            }

            const int hi = 512;
            using (var master = new Bitmap(hi, hi, PixelFormat.Format32bppArgb))
            using (var g = Graphics.FromImage(master))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.Clear(Color.Transparent);

                float strokeW = 14f * ((hi - padAt512 * 2f) / 476f);
                float halfStroke = strokeW * 0.5f;
                float outerPad = padAt512 + halfStroke;
                float cardSize = hi - outerPad * 2f;
                float ox = outerPad;
                float oy = outerPad;
                float s = cardSize / 476f;
                var cardRect = new RectangleF(ox, oy, cardSize, cardSize);
                float radius = 104f * s;

                using (var cardPath = CreateRoundedRect(cardRect, radius))
                {
                    g.SetClip(cardPath);

                    // Sky gradient background
                    using (var skyBrush = new LinearGradientBrush(
                        new PointF(0, oy),
                        new PointF(0, oy + cardSize),
                        Color.FromArgb(11, 7, 26),
                        Color.FromArgb(40, 14, 72)))
                    {
                        g.FillRectangle(skyBrush, cardRect);
                    }

                    // Soft radial magenta aura behind sun
                    float sunSize = 276f * s;
                    float sunX = (hi - sunSize) / 2f;
                    float sunY = oy + 74f * s;
                    using (var auraPath = new GraphicsPath())
                    {
                        auraPath.AddEllipse(sunX - 48f * s, sunY - 48f * s, sunSize + 96f * s, sunSize + 96f * s);
                        using (var pgb = new PathGradientBrush(auraPath))
                        {
                            pgb.CenterColor = Color.FromArgb(145, 255, 42, 133);
                            pgb.SurroundColors = new[] { Color.FromArgb(0, 255, 42, 133) };
                            g.FillPath(pgb, auraPath);
                        }
                    }

                    // Outrun sliced sun
                    float horizonY = oy + 308f * s;
                    using (var sunClip = new Region(new RectangleF(0, 0, hi, horizonY)))
                    {
                        var prevClip = g.Clip.Clone();
                        sunClip.Intersect(cardPath);
                        g.Clip = sunClip;

                        using (var sunPath = new GraphicsPath())
                        {
                            sunPath.AddEllipse(sunX, sunY, sunSize, sunSize);
                            using (var sunBrush = new LinearGradientBrush(
                                new PointF(0, sunY),
                                new PointF(0, horizonY),
                                Color.FromArgb(255, 232, 95),
                                Color.FromArgb(255, 38, 135)))
                            {
                                var cb = new ColorBlend(3);
                                cb.Positions = new[] { 0.0f, 0.55f, 1.0f };
                                cb.Colors = new[] {
                                    Color.FromArgb(255, 230, 102),
                                    Color.FromArgb(255, 108, 62),
                                    Color.FromArgb(255, 34, 136)
                                };
                                sunBrush.InterpolationColors = cb;
                                g.FillPath(sunBrush, sunPath);
                            }
                        }

                        // Horizontal slice cutouts across lower sun
                        using (var cutBrush = new SolidBrush(Color.FromArgb(24, 11, 45)))
                        {
                            float[] cutOffsets = { 198f, 224f, 248f, 270f, 290f };
                            float[] cutHs = { 6f, 9f, 11f, 13f, 14f };
                            for (int i = 0; i < cutOffsets.Length; i++)
                            {
                                g.FillRectangle(cutBrush, sunX - 4f * s, oy + cutOffsets[i] * s, sunSize + 8f * s, cutHs[i] * s);
                            }
                        }

                        g.Clip = prevClip;
                    }

                    // Floor & neon perspective grid
                    using (var floorBrush = new LinearGradientBrush(
                        new PointF(0, horizonY),
                        new PointF(0, oy + cardSize),
                        Color.FromArgb(24, 10, 46),
                        Color.FromArgb(10, 5, 22)))
                    {
                        g.FillRectangle(floorBrush, 0, horizonY, hi, hi - horizonY);
                    }

                    using (var hGlow = new Pen(Color.FromArgb(220, 0, 240, 255), 5f * s))
                    {
                        g.DrawLine(hGlow, 0, horizonY, hi, horizonY);
                    }

                    // Perspective grid lines
                    float vpX = hi / 2f;
                    using (var gridPen = new Pen(Color.FromArgb(210, 255, 42, 165), 4.5f * s))
                    {
                        for (int i = -5; i <= 5; i++)
                        {
                            float bx = vpX + i * 76f * s;
                            g.DrawLine(gridPen, vpX + i * 16f * s, horizonY, bx, oy + cardSize);
                        }
                        float[] rowOffsets = { 330f, 358f, 394f, 438f };
                        foreach (float ro in rowOffsets)
                        {
                            g.DrawLine(gridPen, 0, oy + ro * s, hi, oy + ro * s);
                        }
                    }

                    if (crtShaderOverlay)
                    {
                        // CRT scanlines, phosphor edge vignette & curved glass sheen
                        using (var scanPen = new Pen(Color.FromArgb(42, 4, 1, 14), 2.8f * s))
                        {
                            for (float sy = oy + 4f * s; sy < oy + cardSize; sy += 8f * s)
                            {
                                g.DrawLine(scanPen, ox, sy, ox + cardSize, sy);
                            }
                        }
                        using (var trackingBand = new LinearGradientBrush(
                            new PointF(0, oy + cardSize * 0.20f),
                            new PointF(0, oy + cardSize * 0.27f),
                            Color.FromArgb(0, 0, 240, 255),
                            Color.FromArgb(0, 255, 42, 133)))
                        {
                            var tcb = new ColorBlend(3);
                            tcb.Positions = new[] { 0.0f, 0.5f, 1.0f };
                            tcb.Colors = new[] {
                                Color.FromArgb(0, 0, 240, 255),
                                Color.FromArgb(48, 0, 240, 255),
                                Color.FromArgb(0, 255, 42, 133)
                            };
                            trackingBand.InterpolationColors = tcb;
                            g.FillRectangle(trackingBand, ox, oy + cardSize * 0.20f, cardSize, cardSize * 0.07f);
                        }
                        using (var glassSheen = new LinearGradientBrush(
                            new PointF(ox, oy),
                            new PointF(ox + cardSize * 0.65f, oy + cardSize * 0.65f),
                            Color.FromArgb(46, 255, 255, 255),
                            Color.FromArgb(0, 0, 240, 255)))
                        {
                            g.FillRectangle(glassSheen, cardRect);
                        }
                        using (var vigPen = new Pen(Color.FromArgb(95, 2, 0, 10), 26f * s))
                        {
                            g.DrawPath(vigPen, cardPath);
                        }
                    }

                    g.ResetClip();
                }

                // Crisp neon cyan-to-magenta border ring inset cleanly within outer margin
                using (var borderPath = CreateRoundedRect(cardRect, radius))
                using (var borderBrush = new LinearGradientBrush(
                    new PointF(ox, oy),
                    new PointF(ox + cardSize, oy + cardSize),
                    Color.FromArgb(0, 240, 255),
                    Color.FromArgb(255, 42, 133)))
                using (var borderPen = new Pen(borderBrush, strokeW))
                {
                    g.DrawPath(borderPen, borderPath);
                }

                using (var finalBmp = new Bitmap(size, size, PixelFormat.Format32bppArgb))
                using (var fg = Graphics.FromImage(finalBmp))
                {
                    fg.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    fg.SmoothingMode = SmoothingMode.HighQuality;
                    fg.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    fg.CompositingQuality = CompositingQuality.HighQuality;
                    fg.DrawImage(master, new Rectangle(0, 0, size, size));
                    SavePng(finalBmp, outputPath);
                }
            }
        }

        public static void BuildPromoTile(string sourcePath, string outputPath, int width, int height, bool isMarquee)
        {
            BuildPromoTile(
                sourcePath,
                outputPath,
                width,
                height,
                isMarquee,
                "CHROME THEME",
                "SYNTHWAVE DARK THEME",
                isMarquee
                    ? "1980s Outrun Sunset  •  Glowing Neon Tabs  •  Deep Midnight Contrast"
                    : "1980s Outrun Sunset & Neon UI",
                false
            );
        }

        public static void BuildPromoTile(
            string sourcePath,
            string outputPath,
            int width,
            int height,
            bool isMarquee,
            string badgeText,
            string subtitleText,
            string taglineText,
            bool crtAccent)
        {
            const int ss = 2;
            int mw = width * ss;
            int mh = height * ss;

            using (var src = new Bitmap(sourcePath))
            using (var master = new Bitmap(mw, mh, PixelFormat.Format24bppRgb))
            using (var g = Graphics.FromImage(master))
            {
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.SmoothingMode = SmoothingMode.HighQuality;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.CompositingQuality = CompositingQuality.HighQuality;
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;

                // Dark midnight sky fill
                g.Clear(Color.FromArgb(11, 7, 24));

                // Cover-crop source Outrun wallpaper anchored to the right side with seamless left fade
                double srcAspect = (double)src.Width / src.Height;
                double dstAspect = (double)mw / mh;
                float drawW, drawH;
                if (dstAspect >= srcAspect)
                {
                    drawW = mw * (isMarquee ? 0.76f : 1.00f);
                    drawH = (float)(drawW / srcAspect);
                    if (drawH < mh * 1.02f)
                    {
                        drawH = mh * 1.02f;
                        drawW = (float)(drawH * srcAspect);
                    }
                }
                else
                {
                    drawH = mh * 1.06f;
                    drawW = (float)(drawH * srcAspect);
                }
                float drawX = isMarquee ? (mw - drawW * 0.94f) : (mw * 0.68f - drawW * 0.50f);
                float drawY = (mh - drawH) * (isMarquee ? 0.52f : 0.44f);
                g.DrawImage(src, new RectangleF(drawX, drawY, drawW, drawH));

                // Left dark cosmic vignette covering any wallpaper left boundary seam seamlessly
                float fadeEnd = isMarquee ? Math.Max(mw * 0.54f, drawX + mw * 0.22f) : (mw * 0.72f);
                float seamCover = isMarquee ? Math.Max(0.24f, (drawX + 40f) / mw) : 0.0f;
                using (var scrm = new LinearGradientBrush(
                    new PointF(0, 0),
                    new PointF(mw, 0),
                    Color.FromArgb(255, 11, 7, 24),
                    Color.FromArgb(15, 11, 7, 24)))
                {
                    var cb = new ColorBlend(4);
                    cb.Positions = new[] { 0.0f, Math.Min(0.45f, seamCover + 0.08f), fadeEnd / mw, 1.0f };
                    cb.Colors = new[] {
                        Color.FromArgb(255, 11, 7, 24),
                        Color.FromArgb(255, 11, 7, 24),
                        Color.FromArgb(85, 16, 9, 36),
                        Color.FromArgb(10, 11, 7, 24)
                    };
                    scrm.InterpolationColors = cb;
                    g.FillRectangle(scrm, 0, 0, mw, mh);
                }

                // Subtle bottom & top atmospheric framing gradient
                using (var vShade = new LinearGradientBrush(
                    new PointF(0, 0),
                    new PointF(0, mh),
                    Color.FromArgb(120, 8, 4, 20),
                    Color.FromArgb(150, 8, 4, 20)))
                {
                    var cb = new ColorBlend(3);
                    cb.Positions = new[] { 0.0f, 0.45f, 1.0f };
                    cb.Colors = new[] {
                        Color.FromArgb(105, 8, 4, 20),
                        Color.FromArgb(0, 8, 4, 20),
                        Color.FromArgb(140, 8, 4, 20)
                    };
                    vShade.InterpolationColors = cb;
                    g.FillRectangle(vShade, 0, 0, mw, mh);
                }

                // Full-bleed top synthwave prism horizon bar echoing the browser theme frame
                float beamH = isMarquee ? 10f : 7f;
                using (var topBeam = new LinearGradientBrush(
                    new PointF(0, 0),
                    new PointF(mw, 0),
                    Color.FromArgb(0, 240, 255),
                    Color.FromArgb(255, 42, 133)))
                {
                    var cb = new ColorBlend(3);
                    cb.Positions = new[] { 0.0f, 0.52f, 1.0f };
                    cb.Colors = new[] {
                        Color.FromArgb(0, 240, 255),
                        Color.FromArgb(181, 55, 242),
                        Color.FromArgb(255, 42, 133)
                    };
                    topBeam.InterpolationColors = cb;
                    g.FillRectangle(topBeam, 0, 0, mw, beamH);
                }

                // Subtle CRT scanline sheen across full canvas
                using (var scanPen = new Pen(Color.FromArgb(crtAccent ? 34 : 18, 0, 0, 0), crtAccent ? 2.0f : 1.5f))
                {
                    int scanStep = crtAccent ? 5 : 6;
                    for (int sy = 12; sy < mh; sy += scanStep)
                    {
                        g.DrawLine(scanPen, 0, sy, mw, sy);
                    }
                }

                if (crtAccent)
                {
                    // Subtle full-width VHS tracking shimmer band fading smoothly out on the left behind typography
                    float trackY = mh * 0.25f;
                    float trackH = isMarquee ? 22f : 14f;
                    using (var trackGrad = new LinearGradientBrush(
                        new PointF(0, trackY),
                        new PointF(mw, trackY),
                        Color.FromArgb(0, 0, 240, 255),
                        Color.FromArgb(30, 0, 240, 255)))
                    {
                        var hcb = new ColorBlend(4);
                        hcb.Positions = new[] { 0.0f, 0.44f, 0.68f, 1.0f };
                        hcb.Colors = new[] {
                            Color.FromArgb(0, 0, 240, 255),
                            Color.FromArgb(0, 0, 240, 255),
                            Color.FromArgb(26, 0, 240, 255),
                            Color.FromArgb(14, 255, 42, 133)
                        };
                        trackGrad.InterpolationColors = hcb;
                        g.FillRectangle(trackGrad, 0, trackY + trackH * 0.35f, mw, trackH * 0.35f);
                    }
                    using (var trackSoft = new LinearGradientBrush(
                        new PointF(0, trackY),
                        new PointF(mw, trackY),
                        Color.FromArgb(0, 0, 240, 255),
                        Color.FromArgb(16, 0, 240, 255)))
                    {
                        var scb = new ColorBlend(4);
                        scb.Positions = new[] { 0.0f, 0.44f, 0.68f, 1.0f };
                        scb.Colors = new[] {
                            Color.FromArgb(0, 0, 240, 255),
                            Color.FromArgb(0, 0, 240, 255),
                            Color.FromArgb(14, 0, 240, 255),
                            Color.FromArgb(8, 181, 55, 242)
                        };
                        trackSoft.InterpolationColors = scb;
                        g.FillRectangle(trackSoft, 0, trackY, mw, trackH);
                    }
                }

                float leftPad = isMarquee ? 150f : 48f;
                float badgeY = isMarquee ? 210f : 94f;
                float badgeH = isMarquee ? 60f : 40f;
                float badgeW = isMarquee ? (crtAccent ? 410f : 360f) : (crtAccent ? 255f : 220f);
                var badgeRect = new RectangleF(leftPad, badgeY, badgeW, badgeH);

                // Eyebrow badge pill
                using (var badgePath = CreateRoundedRect(badgeRect, badgeH * 0.5f))
                using (var badgeFill = new SolidBrush(Color.FromArgb(215, 14, 9, 34)))
                using (var badgeStrokeBrush = new LinearGradientBrush(
                    new PointF(badgeRect.Left, badgeRect.Top),
                    new PointF(badgeRect.Right, badgeRect.Bottom),
                    Color.FromArgb(0, 240, 255),
                    Color.FromArgb(255, 42, 133)))
                using (var badgePen = new Pen(badgeStrokeBrush, isMarquee ? 3.5f : 2.5f))
                using (var badgeFont = new Font("Bahnschrift", isMarquee ? 23f : 15f, FontStyle.Bold, GraphicsUnit.Pixel))
                using (var badgeTextBrush = new SolidBrush(Color.FromArgb(145, 248, 255)))
                using (var sfCenter = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                {
                    g.FillPath(badgeFill, badgePath);
                    g.DrawPath(badgePen, badgePath);
                    g.DrawString(badgeText, badgeFont, badgeTextBrush, badgeRect, sfCenter);
                }

                // Main headline with subtle neon magenta/violet aura
                float titleY = badgeY + badgeH + (isMarquee ? 34f : 20f);
                string titleText = "NEON HORIZON";
                using (var titleFont = new Font("Bahnschrift", isMarquee ? 132f : 60f, FontStyle.Bold, GraphicsUnit.Pixel))
                using (var glowBrush = new SolidBrush(Color.FromArgb(crtAccent ? 105 : 85, 255, 42, 165)))
                using (var cyanGlow = new SolidBrush(Color.FromArgb(crtAccent ? 90 : 65, 0, 240, 255)))
                using (var titleBrush = new LinearGradientBrush(
                    new PointF(0, titleY),
                    new PointF(0, titleY + (isMarquee ? 136f : 62f)),
                    Color.FromArgb(255, 255, 255),
                    Color.FromArgb(215, 232, 255)))
                {
                    float gOff = isMarquee ? (crtAccent ? 5.2f : 4f) : (crtAccent ? 2.8f : 2.2f);
                    g.DrawString(titleText, titleFont, cyanGlow, leftPad - gOff, titleY - gOff * 0.5f);
                    g.DrawString(titleText, titleFont, glowBrush, leftPad + gOff, titleY + gOff);
                    g.DrawString(titleText, titleFont, titleBrush, leftPad, titleY);
                }

                // Synthwave gradient divider bar
                float accentY = titleY + (isMarquee ? 152f : 74f);
                float accentW = isMarquee ? 430f : 184f;
                float accentH = isMarquee ? 8f : 4.5f;
                using (var accentBrush = new LinearGradientBrush(
                    new PointF(leftPad, accentY),
                    new PointF(leftPad + accentW, accentY),
                    Color.FromArgb(0, 240, 255),
                    Color.FromArgb(255, 42, 133)))
                {
                    g.FillRectangle(accentBrush, leftPad, accentY, accentW, accentH);
                }

                // Subtitle & concise supporting line
                float subY = accentY + (isMarquee ? 28f : 16f);
                using (var subFont = new Font("Bahnschrift", isMarquee ? 45f : 24f, FontStyle.Bold, GraphicsUnit.Pixel))
                using (var subBrush = new SolidBrush(Color.FromArgb(246, 178, 255)))
                {
                    g.DrawString(subtitleText, subFont, subBrush, leftPad, subY);
                }

                float tagY = subY + (isMarquee ? 68f : 38f);
                using (var tagFont = new Font("Segoe UI", isMarquee ? 30f : 19f, FontStyle.Regular, GraphicsUnit.Pixel))
                using (var tagBrush = new SolidBrush(Color.FromArgb(222, 212, 248)))
                {
                    g.DrawString(taglineText, tagFont, tagBrush, leftPad, tagY);
                }

                using (var finalBmp = new Bitmap(width, height, PixelFormat.Format24bppRgb))
                using (var fg = Graphics.FromImage(finalBmp))
                {
                    fg.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    fg.SmoothingMode = SmoothingMode.HighQuality;
                    fg.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    fg.CompositingQuality = CompositingQuality.HighQuality;
                    fg.DrawImage(master, new Rectangle(0, 0, width, height));
                    SavePng(finalBmp, outputPath);
                }
            }
        }
    }
}
'@

Add-Type -TypeDefinition $csharpSource -ReferencedAssemblies System.Drawing

$sourceNtp = Join-Path $RepoRoot 'assets\ntp_source.jpg'
$imgDir    = Join-Path $ChromeRoot 'theme\images'

if (-not (Test-Path $sourceNtp)) {
    throw "Source NTP artwork not found at: $sourceNtp"
}

Write-Host 'Generating Neon Horizon Synthwave Chrome assets...'

# Shared palette colors matching theme/manifest.json
$cVoidBg       = [SynthwaveAssets.RgbColor]::new(11, 7, 24)     # #0B0718 (ntp_background)
$cFrameTop     = [SynthwaveAssets.RgbColor]::new(9, 5, 20)      # #090514
$cFrameMid     = [SynthwaveAssets.RgbColor]::new(14, 9, 32)     # #0E0920 (colors.frame)
$cFrameBot     = [SynthwaveAssets.RgbColor]::new(24, 12, 50)    # #180C32
$cInactTop     = [SynthwaveAssets.RgbColor]::new(14, 10, 28)
$cInactMid     = [SynthwaveAssets.RgbColor]::new(18, 12, 36)    # #120C24 (colors.frame_inactive)
$cInactBot     = [SynthwaveAssets.RgbColor]::new(24, 16, 46)
$cIncogTop     = [SynthwaveAssets.RgbColor]::new(5, 6, 16)
$cIncogMid     = [SynthwaveAssets.RgbColor]::new(8, 8, 22)      # #080816 (colors.frame_incognito)
$cIncogBot     = [SynthwaveAssets.RgbColor]::new(13, 17, 40)

$cToolTop      = [SynthwaveAssets.RgbColor]::new(72, 26, 124)   # #481A7C (active tab glow peak)
$cToolMid      = [SynthwaveAssets.RgbColor]::new(30, 16, 54)    # #1E1036 (colors.toolbar)
$cToolBot      = [SynthwaveAssets.RgbColor]::new(23, 12, 44)

$cTabBgTop      = [SynthwaveAssets.RgbColor]::new(50, 22, 96)   # #321660 (background tab top gradient)
$cTabBgMid      = [SynthwaveAssets.RgbColor]::new(32, 16, 62)   # #20103E (colors.background_tab)
$cTabBgBot      = [SynthwaveAssets.RgbColor]::new(20, 11, 42)
$cTabInactTop  = [SynthwaveAssets.RgbColor]::new(36, 18, 70)
$cTabInactMid  = [SynthwaveAssets.RgbColor]::new(26, 15, 50)    # #1A0F32 (colors.background_tab_inactive)
$cTabInactBot  = [SynthwaveAssets.RgbColor]::new(17, 10, 34)

$cWinCtrlTop   = [SynthwaveAssets.RgbColor]::new(74, 28, 132)
$cWinCtrlLow   = [SynthwaveAssets.RgbColor]::new(24, 12, 48)

$cNeonPink     = [SynthwaveAssets.RgbColor]::new(255, 42, 133)  # #FF2A85
$cNeonViolet   = [SynthwaveAssets.RgbColor]::new(181, 55, 242)  # #B537F2
$cNeonCyan     = [SynthwaveAssets.RgbColor]::new(0, 240, 255)   # #00F0FF
$cDeepBlue     = [SynthwaveAssets.RgbColor]::new(67, 97, 238)   # #4361EE

$genTheme = ($Target -eq 'All' -or $Target -eq 'Theme')
$genExtension = ($Target -eq 'All' -or $Target -eq 'Extension')

if ($genTheme) {
    # 1. NTP Wallpaper (1920x1080 seamless PNG)
    [SynthwaveAssets.Generator]::BuildNtpWallpaper(
        $sourceNtp,
        (Join-Path $imgDir 'theme_ntp_background.png'),
        1920, 1080, $cVoidBg, 1984
    )
    if (Test-Path (Join-Path $ChromeRoot 'extension\manifest.json')) {
        $extAssetsDir = Join-Path $ChromeRoot 'extension\assets'
        New-Item -ItemType Directory -Force -Path $extAssetsDir | Out-Null
        Copy-Item -Path (Join-Path $imgDir 'theme_ntp_background.png') -Destination (Join-Path $extAssetsDir 'ntp_wallpaper.png') -Force
    }

    # 2. Browser Frame strips (2400x160)
    [SynthwaveAssets.Generator]::BuildUiStrip(
        (Join-Path $imgDir 'theme_frame.png'),
        2400, 160, $cFrameTop, $cFrameMid, $cFrameBot, 0.35,
        $cNeonPink, $cNeonViolet, $cNeonCyan, 0.72, 6, 0.0, 90, 0.55, 1985
    )
    [SynthwaveAssets.Generator]::BuildUiStrip(
        (Join-Path $imgDir 'theme_frame_inactive.png'),
        2400, 160, $cInactTop, $cInactMid, $cInactBot, 0.38,
        $cNeonViolet, $cDeepBlue, $cNeonPink, 0.28, 4, 0.0, 45, 0.28, 1986
    )
    [SynthwaveAssets.Generator]::BuildUiStrip(
        (Join-Path $imgDir 'theme_frame_incognito.png'),
        2400, 160, $cIncogTop, $cIncogMid, $cIncogBot, 0.35,
        $cNeonCyan, $cDeepBlue, $cNeonCyan, 0.65, 5, 0.0, 75, 0.45, 1987
    )

    # 3. Frame Corner Overlays (760x160 transparent RGBA)
    [SynthwaveAssets.Generator]::BuildFrameOverlay((Join-Path $imgDir 'theme_frame_overlay.png'), 760, 160, 1.0)
    [SynthwaveAssets.Generator]::BuildFrameOverlay((Join-Path $imgDir 'theme_frame_overlay_inactive.png'), 760, 160, 0.45)

    # 4. Active Tab + Toolbar strip (2400x140): synthwave tab body gradient + bright top rim transitioning cleanly into #1E1036 toolbar
    [SynthwaveAssets.Generator]::BuildUiStrip(
        (Join-Path $imgDir 'theme_toolbar.png'),
        2400, 140, $cToolTop, $cToolMid, $cToolBot, 0.29,
        $cNeonCyan, $cNeonViolet, $cNeonPink, 0.90, 9, 0.025, 0, 0.0, 1988,
        40.0, 0.30, 3
    )

    # 5. Background Tab strips (2400x100): gradient capsule fill + highlighted top neon rim
    [SynthwaveAssets.Generator]::BuildUiStrip(
        (Join-Path $imgDir 'theme_tab_background.png'),
        2400, 100, $cTabBgTop, $cTabBgMid, $cTabBgBot, 0.38,
        $cNeonViolet, $cNeonPink, $cNeonCyan, 0.58, 7, 0.0, 0, 0.0, 1989,
        36.0, 0.14, 3
    )
    [SynthwaveAssets.Generator]::BuildUiStrip(
        (Join-Path $imgDir 'theme_tab_background_inactive.png'),
        2400, 100, $cTabInactTop, $cTabInactMid, $cTabInactBot, 0.38,
        $cDeepBlue, $cNeonViolet, $cDeepBlue, 0.30, 5, 0.0, 0, 0.0, 1990,
        36.0, 0.08, 3
    )

    # 6. Window Control Caption Buttons soft gradient underlay (360x80 transparent RGBA)
    [SynthwaveAssets.Generator]::BuildWindowControlBackground(
        (Join-Path $imgDir 'theme_window_control_background.png'),
        360, 80, $cWinCtrlTop, $cWinCtrlLow,
        $cNeonViolet, $cNeonPink, $cNeonCyan, 40.0, 1
    )

    # 7. Extension / Theme Icons (16, 48, 128)
    foreach ($iconSize in @(16, 48, 128)) {
        [SynthwaveAssets.Generator]::BuildThemeIcon(
            (Join-Path $imgDir "icon$iconSize.png"),
            $iconSize
        )
    }

    # 8. Chrome Web Store listing assets for Theme (128x128 padded icon + 24-bit opaque promo tiles)
    $storeDir = Join-Path $ChromeRoot 'store'
    New-Item -ItemType Directory -Force -Path $storeDir | Out-Null

    # CWS Store Icon: 96x96 artwork with 16px transparent margin on all sides (64px at 512px master)
    [SynthwaveAssets.Generator]::BuildThemeIcon(
        (Join-Path $storeDir 'store-icon-128.png'),
        128, 64.0
    )

    # Small Promo Tile (440x280) & Marquee Promo Tile (1400x560)
    [SynthwaveAssets.Generator]::BuildPromoTile(
        $sourceNtp,
        (Join-Path $storeDir 'promo-small-440x280.png'),
        440, 280, $false
    )
    [SynthwaveAssets.Generator]::BuildPromoTile(
        $sourceNtp,
        (Join-Path $storeDir 'promo-marquee-1400x560.png'),
        1400, 560, $true
    )

    Write-Host "Successfully generated 13 theme PNG assets in $imgDir and 3 store PNG assets in $storeDir"
}

if ($genExtension) {
    $extStoreDir = Join-Path $ChromeRoot 'store\extension'
    New-Item -ItemType Directory -Force -Path $extStoreDir | Out-Null

    # CWS Extension Store Icon: 96x96 CRT/VHS artwork with 16px transparent padding (64px at 512px master)
    [SynthwaveAssets.Generator]::BuildThemeIcon(
        (Join-Path $extStoreDir 'store-icon-128.png'),
        128, 64.0, $true
    )

    # Extension Small Promo Tile (440x280) & Marquee/Large Promo Tile (1400x560)
    [SynthwaveAssets.Generator]::BuildPromoTile(
        $sourceNtp,
        (Join-Path $extStoreDir 'promo-small-440x280.png'),
        440, 280, $false,
        'CHROME EXTENSION',
        'CRT & VHS SHADER',
        'WebGL2 New Tab & CRT/VHS Overlay',
        $true
    )
    [SynthwaveAssets.Generator]::BuildPromoTile(
        $sourceNtp,
        (Join-Path $extStoreDir 'promo-marquee-1400x560.png'),
        1400, 560, $true,
        'CHROME EXTENSION',
        'CRT & VHS SHADER',
        "Animated WebGL2 New Tab  •  CRT Screen Curvature  •  VHS & Bloom",
        $true
    )

    Write-Host "Successfully generated 3 extension store PNG assets in $extStoreDir"
}
