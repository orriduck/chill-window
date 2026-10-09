[out:json][timeout:60];
(
  nwr["railway"~"^(station|halt|platform|stop)$"](41.25,-74.08,41.46,-73.85);
  nwr["public_transport"="platform"]["train"="yes"](41.25,-74.08,41.46,-73.85);
  relation["public_transport"="stop_area"]["network"="Metro-North Railroad"](41.25,-74.08,41.46,-73.85);
);
out body geom;
