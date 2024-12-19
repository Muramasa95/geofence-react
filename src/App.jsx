import React, { useEffect, useRef, useState } from "react";
import JSZip from "jszip";

const MapComponent = () => {
  const mapRef = useRef(null);
  const [map, setMap] = useState(null);
  const [drawingManager, setDrawingManager] = useState(null);
  const [markers, setMarkers] = useState([]);
  const [currentPolygon, setCurrentPolygon] = useState(null);
  const [mode, setMode] = useState("none");
  const [status, setStatus] = useState("");
  const directionsRendererRef = useRef(null);
  const [currentRoute, setCurrentRoute] = useState(null);

  const DEFAULT_CENTER = { lat: 23.8859, lng: 45.0792 };
  const DEFAULT_ZOOM = 6;

  const [pointSpacing, setPointSpacing] = useState(15); // Default 15 meters

  useEffect(() => {
    if (!mapRef.current || !window.google || !window.google.maps) return;

    if (!window.google.maps.drawing) {
      console.error("Drawing library not loaded");
      setStatus("Error: Drawing library not loaded");
      return;
    }

    const mapInstance = new window.google.maps.Map(mapRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      mapTypeId: "roadmap",
      mapTypeControl: true,
      streetViewControl: true,
      fullscreenControl: true,
      zoomControl: true,
      language: "ar",
      mapTypeControlOptions: {
        style: window.google.maps.MapTypeControlStyle.DROPDOWN_MENU,
        position: window.google.maps.ControlPosition.TOP_RIGHT,
      },
    });

    directionsRendererRef.current = new window.google.maps.DirectionsRenderer({
      map: mapInstance,
      suppressMarkers: true,
      draggable: true,
      polylineOptions: {
        strokeColor: "#4285F4", // Google Maps default blue
        strokeOpacity: 1.0,
        strokeWeight: 4,
      },
    });

    window.google.maps.event.addListener(
      directionsRendererRef.current,
      "directions_changed",
      () => {
        const result = directionsRendererRef.current.getDirections();
        if (result) {
          // This will store the modified route
          setCurrentRoute(result);
          // Update the info display
          updateRouteInfo(result);
        }
      }
    );

    try {
      const drawingManagerInstance =
        new window.google.maps.drawing.DrawingManager({
          drawingMode: null,
          drawingControl: false,
          polygonOptions: {
            fillColor: "#FF0000",
            fillOpacity: 0.3,
            strokeWeight: 2,
            strokeColor: "#FF0000",
            editable: true,
          },
        });

      drawingManagerInstance.setMap(mapInstance);
      window.google.maps.event.addListener(
        drawingManagerInstance,
        "polygoncomplete",
        (polygon) => {
          if (currentPolygon) {
            currentPolygon.setMap(null);
          }
          setCurrentPolygon(polygon);
          drawingManagerInstance.setDrawingMode(null);

          const coordinates = polygon
            .getPath()
            .getArray()
            .map((coord) => ({
              lat: coord.lat(),
              lng: coord.lng(),
            }));
          console.log("Geofence coordinates:", coordinates);
          setStatus("Geofence created successfully");
        }
      );

      setMap(mapInstance);
      setDrawingManager(drawingManagerInstance);
    } catch (error) {
      console.error("Error initializing drawing manager:", error);
      setStatus("Error initializing drawing tools");
    }
  }, []);

  useEffect(() => {
    if (!map) return;

    const clickListener = map.addListener("click", (event) => {
      if (mode === "routing") {
        addMarker(event.latLng);
      }
    });

    return () => {
      window.google.maps.event.removeListener(clickListener);
    };
  }, [map, mode]);

  const getRouteCoordinates = () => {
    if (!currentRoute || !currentRoute.routes || !currentRoute.routes[0]) {
      return null;
    }

    const route = currentRoute.routes[0];
    const path = route.overview_path || [];
    return path.map((point) => ({
      lat: point.lat(),
      lng: point.lng(),
    }));
  };

  const exportRoute = async () => {
    if (!currentRoute?.routes?.[0]) {
      setStatus("No route to export");
      return;
    }

    const coordinates = [];
    const modifiedRoute = directionsRendererRef.current.getDirections();
    const route = modifiedRoute.routes[0];

    // Helper function to detect roundabouts based on path geometry
    function isRoundabout(path) {
      if (path.length < 4) return false;

      // Check for circular pattern
      let totalAngle = 0;
      for (let i = 1; i < path.length - 1; i++) {
        const angle = calculateTurnAngle(path[i - 1], path[i], path[i + 1]);
        totalAngle += angle;
      }

      // If total angle change is close to 270-360 degrees, likely a roundabout
      return Math.abs(totalAngle) > 250 && Math.abs(totalAngle) < 370;
    }

    // Helper function to calculate turn angle between three points
    function calculateTurnAngle(p1, p2, p3) {
      const bearing1 = google.maps.geometry.spherical.computeHeading(p1, p2);
      const bearing2 = google.maps.geometry.spherical.computeHeading(p2, p3);
      let angle = bearing2 - bearing1;

      // Normalize angle to [-180, 180]
      while (angle > 180) angle -= 360;
      while (angle < -180) angle += 360;

      return angle;
    }

    // Helper function to sample points with adaptive spacing
    function sampleAdaptivePoints(path, isRoundaboutSection) {
      const sampledPoints = [];
      const baseSpacing = isRoundaboutSection ? pointSpacing / 3 : pointSpacing; // More dense sampling for roundabouts

      for (let i = 0; i < path.length - 1; i++) {
        const startPoint = path[i];
        const endPoint = path[i + 1];
        const distance = google.maps.geometry.spherical.computeDistanceBetween(
          startPoint,
          endPoint
        );

        sampledPoints.push(startPoint);

        if (distance > baseSpacing) {
          const numPoints = Math.ceil(distance / baseSpacing);

          // Add intermediate points
          for (let j = 1; j < numPoints; j++) {
            const fraction = j / numPoints;
            const interpolatedPoint =
              google.maps.geometry.spherical.interpolate(
                startPoint,
                endPoint,
                fraction
              );
            sampledPoints.push(interpolatedPoint);
          }
        }
      }

      sampledPoints.push(path[path.length - 1]);
      return sampledPoints;
    }

    route.legs.forEach((leg) => {
      leg.steps.forEach((step) => {
        // Get the detailed path for this step
        const path =
          step.path ||
          google.maps.geometry.encoding.decodePath(step.polyline.points);

        // Check if this segment contains a roundabout
        const isRoundaboutSection = isRoundabout(path);

        // Sample points with adaptive spacing
        const sampledPoints = sampleAdaptivePoints(path, isRoundaboutSection);

        // Add the sampled points to coordinates
        sampledPoints.forEach((point) => {
          coordinates.push(
            `${point.lng().toFixed(6)},${point.lat().toFixed(6)}`
          );
        });
      });
    });

    // Remove consecutive duplicates while preserving path accuracy
    const uniqueCoords = coordinates.filter((coord, index, array) => {
      if (index === 0) return true;

      const [prevLng, prevLat] = array[index - 1].split(",").map(Number);
      const [currLng, currLat] = coord.split(",").map(Number);

      // Keep points that are sufficiently different
      const threshold = 0.00001; // Approximately 1 meter
      return (
        Math.abs(prevLng - currLng) > threshold ||
        Math.abs(prevLat - currLat) > threshold
      );
    });

    // Split into chunks if needed (file size management)
    const chunkSize = Math.ceil(
      uniqueCoords.length / Math.ceil(uniqueCoords.join(",").length / 9000)
    );
    const chunks = [];

    for (let i = 0; i < uniqueCoords.length; i += chunkSize) {
      chunks.push(uniqueCoords.slice(i, i + chunkSize));
    }

    const zip = new JSZip();
    chunks.forEach((chunk, index) => {
      zip.file(`route-part-${index + 1}.txt`, chunk.join(","));
    });

    const content = await zip.generateAsync({ type: "blob" });
    const url = window.URL.createObjectURL(content);
    const link = document.createElement("a");
    link.href = url;
    link.download = "route-export.zip";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    setStatus(`Route exported in ${chunks.length} parts`);
  };

  const updateRouteInfo = (result) => {
    if (
      result.routes &&
      result.routes[0] &&
      result.routes[0].legs &&
      result.routes[0].legs[0]
    ) {
      const distance = result.routes[0].legs[0].distance.text;
      const duration = result.routes[0].legs[0].duration.text;
      setStatus(`المسافة: ${distance} (الوقت: ${duration})`);
      setCurrentRoute(result);
    }
  };

  const clearRoute = () => {
    if (directionsRendererRef.current) {
      // First remove the renderer completely
      directionsRendererRef.current.setMap(null);
      // Create a completely new renderer instance
      directionsRendererRef.current = new window.google.maps.DirectionsRenderer(
        {
          map: map,
          suppressMarkers: true,
          draggable: true,
          preserveViewport: true,
          polylineOptions: {
            strokeColor: "#4285F4",
            strokeOpacity: 1.0,
            strokeWeight: 4,
          },
        }
      );

      // Reattach the directions_changed listener
      window.google.maps.event.addListener(
        directionsRendererRef.current,
        "directions_changed",
        () => {
          const result = directionsRendererRef.current.getDirections();
          if (result) {
            setCurrentRoute(result);
            updateRouteInfo(result);
          }
        }
      );
    }
    setCurrentRoute(null);
    // Clear any existing markers
    markers.forEach((marker) => marker.setMap(null));
    setMarkers([]);
  };

  const addMarker = (location) => {
    if (!map) return;

    const newMarker = new window.google.maps.Marker({
      position: location,
      map: map,
      draggable: true,
    });

    window.google.maps.event.addListener(newMarker, "dragend", () => {
      const currentMarkers = markers.slice();
      if (currentMarkers.length === 2) {
        calculateRoute(currentMarkers[0], currentMarkers[1]);
      }
    });

    setMarkers((prevMarkers) => {
      let newMarkers;
      if (prevMarkers.length >= 2) {
        prevMarkers.forEach((marker) => marker.setMap(null));
        clearRoute();
        newMarkers = [newMarker];
      } else {
        newMarkers = [...prevMarkers, newMarker];
      }

      if (newMarkers.length === 2) {
        calculateRoute(newMarkers[0], newMarkers[1]);
      }

      return newMarkers;
    });
  };

  const calculateRoute = (startMarker, endMarker) => {
    if (!map) return;

    // Clear existing route first
    clearRoute();

    const directionsService = new window.google.maps.DirectionsService();

    const request = {
      origin: startMarker.getPosition(),
      destination: endMarker.getPosition(),
      travelMode: window.google.maps.TravelMode.DRIVING,
      language: "ar",
      provideRouteAlternatives: false,
      avoidHighways: false,
      avoidTolls: false,
      optimizeWaypoints: true,
      drivingOptions: {
        departureTime: new Date(),
        trafficModel: google.maps.TrafficModel.BEST_GUESS,
      },
    };

    directionsService.route(request, (result, status) => {
      if (status === "OK") {
        // Ensure the renderer is properly initialized
        if (!directionsRendererRef.current) {
          clearRoute();
        }
        directionsRendererRef.current.setDirections(result);
        updateRouteInfo(result);
      } else {
        setStatus(`Could not calculate route: ${status}`);
      }
    });
  };

  const handleStartRouting = () => {
    setMode("routing");
    if (drawingManager) {
      drawingManager.setDrawingMode(null);
    }
    // Ensure complete cleanup
    clearRoute();
    setStatus("انقر على الخريطة لتحديد نقطة البداية والنهاية");
  };

  const handleStartGeofencing = () => {
    if (!drawingManager) {
      setStatus("Error: Drawing tools not available");
      return;
    }
    setMode("geofencing");
    clearRoute();
    drawingManager.setDrawingMode(
      window.google.maps.drawing.OverlayType.POLYGON
    );
    setStatus("انقر على الخريطة لرسم المنطقة");
  };

  const handleClear = () => {
    // Clear all markers
    markers.forEach((marker) => marker.setMap(null));
    setMarkers([]);

    // Clear polygon if exists
    if (currentPolygon) {
      currentPolygon.setMap(null);
      setCurrentPolygon(null);
    }

    // Clear route and reset directionsRenderer
    if (directionsRendererRef.current) {
      directionsRendererRef.current.setMap(null);
      // Create a new directionsRenderer instance
      directionsRendererRef.current = new window.google.maps.DirectionsRenderer(
        {
          map: map,
          suppressMarkers: true,
          draggable: true,
          polylineOptions: {
            strokeColor: "#4285F4",
            strokeOpacity: 1.0,
            strokeWeight: 4,
          },
        }
      );

      // Re-attach the directions_changed listener
      window.google.maps.event.addListener(
        directionsRendererRef.current,
        "directions_changed",
        () => {
          const result = directionsRendererRef.current.getDirections();
          if (result) {
            setCurrentRoute(result);
            updateRouteInfo(result);
          }
        }
      );
    }

    // Reset current route state
    setCurrentRoute(null);

    // Reset mode
    setMode("none");

    // Reset drawing manager if exists
    if (drawingManager) {
      drawingManager.setDrawingMode(null);
    }

    setStatus("تم مسح الخريطة");
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4">
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold">خريطة المملكة العربية السعودية</h2>
          <div className="space-x-2">
            <button
              className={`px-4 py-2 ${
                mode === "routing" ? "bg-green-500" : "bg-blue-500"
              } text-white rounded-md hover:opacity-90`}
              onClick={handleStartRouting}
            >
              {mode === "routing" ? "وضع التوجيه نشط" : "بدء التوجيه"}
            </button>
            <button
              className={`px-4 py-2 ${
                mode === "geofencing" ? "bg-green-500" : "bg-blue-500"
              } text-white rounded-md hover:opacity-90`}
              onClick={handleStartGeofencing}
              disabled={!drawingManager}
            >
              {mode === "geofencing" ? "وضع الرسم نشط" : "رسم منطقة"}
            </button>
            <button
              className="px-4 py-2 bg-red-500 text-white rounded-md hover:opacity-90"
              onClick={handleClear}
              disabled={markers.length === 0 && !currentPolygon}
            >
              مسح
            </button>
            {currentRoute && (
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={pointSpacing}
                  onChange={(e) => setPointSpacing(Number(e.target.value))}
                  className="px-2 py-1 border rounded-md w-20 text-center"
                />
                <span className="text-sm text-gray-600 ml-1">متر</span>
                <button
                  className="px-4 py-2 bg-purple-500 text-white rounded-md hover:opacity-90"
                  onClick={exportRoute}
                >
                  تصدير المسار
                </button>
              </div>
            )}
          </div>
        </div>

        <div
          ref={mapRef}
          className="w-full h-[600px] relative rounded-lg border border-gray-200 overflow-hidden"
        />

        <div className="bg-gray-100 p-3 rounded-lg space-y-1">
          <p className="font-medium">{status || "اختر أداة للبدء"}</p>
          <div className="text-sm text-gray-600">
            <p>
              الوضع الحالي:{" "}
              {mode === "none"
                ? "لا شيء"
                : mode === "routing"
                ? "🚗 التوجيه"
                : "🔷 رسم المنطقة"}
            </p>
            {mode === "routing" && (
              <>
                <p>النقاط المحددة: {markers.length} / 2</p>
                {currentRoute && (
                  <>
                    <p>يمكنك تعديل المسار عن طريق السحب</p>
                    <p>اضغط على زر تصدير المسار لحفظ الإحداثيات</p>
                  </>
                )}
              </>
            )}
            {mode === "geofencing" && (
              <p>
                المنطقة: {currentPolygon ? "تم الإنشاء ✅" : "لم يتم الإنشاء"}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default MapComponent;
