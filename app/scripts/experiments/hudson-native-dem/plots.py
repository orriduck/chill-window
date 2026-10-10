"""Scientific diagnostics only: source coordinates, no browser renderer."""
import json
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LightSource
from matplotlib.collections import LineCollection
import numpy as np
from PIL import Image
from pyproj import Transformer

from source import digest


def projection(runtime):
    lon, lat = runtime['projection']['origin']
    r, rad = 6378137., np.pi / 180
    k = np.cos(lat * rad)
    x0, y0 = r * lon * rad, r * np.log(np.tan(np.pi / 4 + lat * rad / 2))
    def local(mx, my):
        return (np.asarray(mx) - x0) * k, (np.asarray(my) - y0) * k
    return local


def overlay(ax, runtime, grid=False):
    points = runtime['poses']
    route = np.array([[p['x'], p['z']] for p in points])
    ax.plot(*route.T, color='cyan', lw=1.5, label='Official route')
    for side in (-18, 18):
        band = np.array([[p['x'] + side * p['right']['x'], p['z'] + side * p['right']['z']] for p in points])
        ax.plot(*band.T, color='cyan', ls='--', lw=.7, label='±18m rail-bed band' if side == 18 else None)
    for rail in runtime['rails']:
        xy = np.array([[p['x'], p['z']] for p in rail['coordinates']])
        track = rail['tags'].get('railway:track_ref', rail['tags'].get('track_ref', '?'))
        ax.plot(*xy.T, lw=.9, label=f'OSM {rail["id"]}, track {track}')
    p = next(p for p in points if p['s'] == 2790)
    ax.scatter(p['x'], p['z'], s=25, c='red', zorder=10)
    for direction, color, label in [('view', 'red', '2790 right-window yaw view'), ('right', 'orange', 'Perpendicular right')]:
        d = p[direction]
        ax.arrow(p['x'], p['z'], d['x'] * 65, d['z'] * 65, color=color, width=.5, head_width=5, length_includes_head=True, label=label, zorder=11)
    if grid:
        dem = np.array(runtime['grids']['dem20m'])
        ax.scatter(*dem.T, s=9, c='black', label='Current ~20m DEM points')
        segments = [t['vertices'] + [t['vertices'][0]] for t in runtime['grids']['mesh8m']]
        ax.add_collection(LineCollection(segments, colors='#9a43b5', linewidths=.3, label='Actual 8m indexed tile triangles'))
    x0, z0, x1, z1 = runtime['bounds']
    ax.set(xlim=(x0, x1), ylim=(z0, z1), xlabel='GeoData X (m)', ylabel='GeoData Z (m)')
    ax.set_aspect('equal')
    ax.ticklabel_format(useOffset=False, style='plain')


def maps(runtime, native, imagery, out):
    pixels, valid, gt, c0, r0, _, meta = native
    rows, cols = np.indices(pixels.shape)
    ux = gt[0] + (cols + c0 + .5) * gt[1]
    uy = gt[3] + (rows + r0 + .5) * gt[5]
    mx, my = Transformer.from_crs(meta['decodedCrsWkt'], 'EPSG:3857', always_xy=True).transform(ux, uy)
    xx, zz = projection(runtime)(mx, my)
    ground = np.where(valid, pixels, np.nan)
    shade = LightSource(azdeg=315, altdeg=45).hillshade(np.nan_to_num(ground), vert_exag=1, dx=1, dy=1)
    shade[~valid] = np.nan
    fig, axes = plt.subplots(1, 3, figsize=(18, 8), layout='constrained')
    axes[0].pcolormesh(xx, zz, shade, cmap='gray', shading='nearest', rasterized=True)
    levels = np.arange(np.floor(np.nanmin(ground) / 5) * 5, np.ceil(np.nanmax(ground) / 5) * 5 + 1, 5) if valid.any() else []
    if len(levels) > 1:
        contour = axes[0].contour(xx, zz, ground, levels=levels, colors='#436636', linewidths=.6)
        axes[0].clabel(contour, fontsize=6, fmt='%gm')
    axes[0].set_title('Native 1m bare earth: hillshade + 5m contours\nNAVD88 source declaration, no vertical adjustment')
    manifest_path = imagery / 'scene-atlases.json'
    raw = manifest_path.read_bytes()
    manifest = json.loads(raw)
    if manifest['worldJsonSha256'] != runtime['sourceHashes']['world']:
        raise RuntimeError('NAIP atlas manifest route hash differs from runtime world')
    records, local = [], projection(runtime)
    for atlas in manifest['atlases']:
        relevant = []
        for placement in atlas['placements']:
            bx0, by0, bx1, by1 = placement['bounds3857']
            lx0, lz0 = local(bx0, by0); lx1, lz1 = local(bx1, by1)
            x0, z0, x1, z1 = runtime['bounds']
            if lx0 <= x1 and lx1 >= x0 and lz0 <= z1 and lz1 >= z0:
                relevant.append((placement, [float(lx0), float(lx1), float(lz0), float(lz1)]))
        if not relevant:
            continue
        image_path = imagery / atlas['image']['path']
        if digest(image_path.read_bytes()) != atlas['image']['sha256']:
            raise RuntimeError('NAIP atlas image SHA mismatch')
        with Image.open(image_path) as image:
            for placement, extent in relevant:
                rect = placement['contentRectPxFromTopLeft']
                # Edge blocks can have a 427px atlas cell but smaller native
                # valid extent. Map only the source-sized pixels to its bounds.
                width, height = placement['validSourceSizePx']
                crop = image.crop((rect['x'], rect['y'], rect['x'] + width, rect['y'] + height))
                axes[1].imshow(crop, origin='upper', extent=extent, interpolation='nearest')
                records.append({'atlas': atlas['image'], 'tileId': placement['tileId'], 'bounds3857': placement['bounds3857'], 'localExtent': extent, 'contentRectPxFromTopLeft': rect, 'usedValidSourceSizePx': [width, height], 'cropRGBABytesSha256': digest(crop.tobytes())})
    if not records:
        raise RuntimeError('No prepared NAIP atlas placement covers diagnostic window')
    axes[1].set_title('Prepared 2022-10-22 NAIP atlas georegistration\nUSDA-FSA APFO / NOAA; alignment requires pixel inspection')
    axes[2].set_facecolor('#f3f3f3')
    axes[2].set_title('Separate sampling grids\n~20m DEM points and exact indexed 8m triangles')
    for i, ax in enumerate(axes):
        overlay(ax, runtime, grid=i == 2)
    axes[2].legend(fontsize=6, loc='upper left')
    fig.suptitle('s=2590–2990m: diagnostic source comparison — no runtime import / no visual acceptance', fontsize=11)
    fig.savefig(out / 'map-panels.png', dpi=150)
    plt.close(fig)
    return {'manifestSha256': digest(raw), 'sourceDate': manifest['sourceDate'], 'credit': manifest['licenseAndCredit'], 'crops': records,
            'registrationMethod': 'Exact atlas content rectangles to manifest EPSG:3857 bounds, then GeoData local scaled-Mercator affine', 'pixelsVisuallyInspected': False}


def profiles(runtime, out):
    fig, axes = plt.subplots(5, 1, figsize=(11, 17), layout='constrained', sharex=True)
    series = [('native1m', 'Native 1m bilinear bare earth'), ('raw20m', 'Current ~20m bilinear'), ('railBed', 'Current ±18m rail-bed function'), ('nearMesh', 'Actual indexed 8m mesh +0.18m')]
    for ax, s in zip(axes, runtime['crossSections']):
        rows = [p for p in runtime['samples'] if p['s'] == s]
        for key, label in series:
            ax.plot([p['offset'] for p in rows], [np.nan if p[key] is None else p[key] for p in rows], label=label, lw=1)
        pose = next(p for p in runtime['poses'] if p['s'] == s)
        ax.axhline(pose['railHeight'], color='black', lw=.8, ls='--', label='Unchanged rail height')
        ax.axhline(pose['eyeHeight'], color='red', lw=.8, ls=':', label='Unchanged rail +2m eye')
        ax.axvspan(-18, 18, alpha=.08, color='cyan')
        ax.set(title=f's={s}m; negative left / positive right of actual route tangent', ylabel='Source/scene height (m)')
        ax.grid(alpha=.2)
    axes[0].legend(fontsize=7, ncol=2)
    axes[-1].set_xlabel('Lateral offset (m)')
    fig.suptitle('Unadjusted source/scene comparisons; prepared 20m vertical realization unverified', fontsize=11)
    fig.savefig(out / 'cross-sections.png', dpi=150)
    plt.close(fig)


def validity_map(runtime, native, out):
    """Actual cropped mask and decoded tile boundaries, independent of index promises."""
    pixels, valid, gt, c0, r0, _, meta = native
    rows, cols = np.indices(pixels.shape)
    ux, uy = gt[0] + (cols+c0+.5)*gt[1], gt[3] + (rows+r0+.5)*gt[5]
    transform = Transformer.from_crs(meta['decodedCrsWkt'], 'EPSG:3857', always_xy=True)
    xx, zz = projection(runtime)(*transform.transform(ux, uy))
    fig, ax = plt.subplots(figsize=(10, 10), layout='constrained')
    ax.pcolormesh(xx, zz, valid.astype(int), cmap='RdYlGn', vmin=0, vmax=1, shading='nearest', rasterized=True)
    for tile in meta['tiles']:
        x0, y0, x1, y1 = tile['extent']
        x, z = projection(runtime)(*transform.transform([x0,x1,x1,x0,x0], [y0,y0,y1,y1,y0]))
        ax.plot(x, z, lw=1.5, ls='--', label=tile['filename'] + ' decoded bounds')
    samples = runtime['samples']
    missing = [p for p in samples if p['native1m'] is None]
    if missing:
        ax.scatter([p['x'] for p in missing], [p['z'] for p in missing], c='magenta', s=6, label='Invalid bilinear native samples')
    overlay(ax, runtime)
    ax.set_title('Actual Putnam native validity mask and tile seam\nGreen=valid pixel, red=masked; magenta=invalid four-pixel bilinear sample')
    ax.legend(fontsize=6, loc='upper left')
    fig.savefig(out / 'native-validity-seam.png', dpi=150)
    plt.close(fig)
