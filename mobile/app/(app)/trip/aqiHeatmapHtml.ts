export const AQI_HEATMAP_HTML = `
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
<style>
  html, body, #map { height: 100%; margin: 0; padding: 0; background: #111; }
  .leaflet-control-attribution { font-size: 9px; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js"></script>
<script>
  var map = L.map('map', { zoomControl: true }).setView([21.0469, 105.7855], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  var vehicleMarker = null;
  var heatLayer = null;
  var hasInitialCenter = false;

  function renderData(data) {
    var center = data.center;
    var points = data.points; // [[lat, lng, aqi], ...]

    if (!hasInitialCenter) {
      map.setView([center.lat, center.lng], 14);
      hasInitialCenter = true;
    }

    if (vehicleMarker) map.removeLayer(vehicleMarker);
    vehicleMarker = L.circleMarker([center.lat, center.lng], {
      radius: 7, color: '#fff', weight: 2, fillColor: '#2196f3', fillOpacity: 1
    }).addTo(map);

    if (heatLayer) map.removeLayer(heatLayer);
    if (!points || points.length === 0) return;

    // Chuan hoa AQI (0-300+) ve intensity 0-1 cho Leaflet.heat
    var heatPoints = points.map(function (p) {
      var intensity = Math.min(p[2] / 300, 1);
      return [p[0], p[1], intensity];
    });

    heatLayer = L.heatLayer(heatPoints, {
      radius: 35,
      blur: 25,
      maxZoom: 17,
      gradient: {
        0.0: '#00e400',  // Tot
        0.17: '#ffff00', // Trung binh
        0.33: '#ff7e00', // Kem cho nhom nhay cam
        0.5: '#ff0000',  // Co hai
        0.67: '#8f3f97', // Rat co hai
        1.0: '#7e0023'   // Nguy hai
      }
    }).addTo(map);
  }

  function handleMessage(event) {
    try {
      var data = JSON.parse(event.data);
      renderData(data);
    } catch (e) {}
  }

  // WebView.postMessage tu React Native: iOS bat qua window, Android qua document
  document.addEventListener('message', handleMessage);
  window.addEventListener('message', handleMessage);
</script>
</body>
</html>
`;
