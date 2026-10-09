[out:json][timeout:90][maxsize:134217728];
(

  way["highway"](41.25,-74.08,41.46,-73.85);
  way["railway"~"^(rail|light_rail|tram|narrow_gauge|disused|abandoned)$"](41.25,-74.08,41.46,-73.85);
);
out body geom;
