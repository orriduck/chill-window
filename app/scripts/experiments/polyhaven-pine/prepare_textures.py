"""Prepare source foliage alpha and 1k twig PBR maps for Blender 4.4.3 export."""
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parent/'textures'
# Use the source's dedicated grayscale leaf alpha, not JPEG leaf maps.
d=Image.open(root/'pine_tree_01_twig_diff_1k.png').convert('RGB')
a=Image.open(root/'pine_tree_01_twig_alpha_1k.png').convert('L')
assert d.size==a.size
# glTF baseColorTexture uses RGBA; preserve the source alpha values exactly.
d.putalpha(a)
d.save(root/'pine_tree_01_twig_diff_alpha_1k.png',optimize=True)
# Twig roughness and normal remain 1k PBR maps; JPEG keeps the GLB smaller.
for name in ('twig_nor_gl','twig_rough'):
    src=root/f'pine_tree_01_{name}_1k.png'
    image=Image.open(src).convert('RGB')
    dest=root/f'pine_tree_01_{name}_1k.jpg'
    image.save(dest,'JPEG',quality=94,subsampling=0,optimize=True)
    print(dest.name,dest.stat().st_size,image.size)
print('leaf RGBA bytes',(root/'pine_tree_01_twig_diff_alpha_1k.png').stat().st_size)
