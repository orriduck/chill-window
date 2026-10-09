[out:json][timeout:90][maxsize:134217728];
(

  way["natural"~"^(water|wood)$"](41.25,-74.08,41.46,-73.85);
  relation["type"="multipolygon"]["natural"~"^(water|wood)$"](41.25,-74.08,41.46,-73.85);
  way["waterway"="riverbank"](41.25,-74.08,41.46,-73.85);
  relation["type"="multipolygon"]["waterway"="riverbank"](41.25,-74.08,41.46,-73.85);
);
out body geom;
