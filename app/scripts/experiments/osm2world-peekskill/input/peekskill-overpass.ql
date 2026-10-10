[out:xml][timeout:60];
(
  way["building"](41.2833,-73.9335,41.2863,-73.9295);
  relation["building"](41.2833,-73.9335,41.2863,-73.9295);
  way["building:part"](41.2833,-73.9335,41.2863,-73.9295);
  way["highway"](41.2833,-73.9335,41.2863,-73.9295);
  way["railway"](41.2833,-73.9335,41.2863,-73.9295);
  way["landuse"~"residential|commercial|industrial|forest|grass|meadow|retail"](41.2833,-73.9335,41.2863,-73.9295);
  way["natural"~"water|wood"](41.2833,-73.9335,41.2863,-73.9295);
  way["waterway"](41.2833,-73.9335,41.2863,-73.9295);
);
(._;>;);
out body;
