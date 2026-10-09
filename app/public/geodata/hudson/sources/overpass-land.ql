[out:json][timeout:90][maxsize:134217728];
(

  way["landuse"~"^(forest|farmland|orchard|vineyard|reservoir)$"](41.25,-74.08,41.46,-73.85);
  relation["type"="multipolygon"]["landuse"~"^(forest|farmland|orchard|vineyard|reservoir)$"](41.25,-74.08,41.46,-73.85);
);
out body geom;
