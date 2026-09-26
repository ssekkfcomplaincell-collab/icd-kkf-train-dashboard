"use client";

import { Fragment, useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { DivIcon } from "leaflet";
import { StationRow } from "@/lib/types";
import fallbackStationCoordinates from "@/data/station-coordinates.json";

export type MapTrainInstance = {
  key: string; trainNo: string; stations: StationRow[]; departureDate: Date; percent: number; currentStationName: string;
};

function isExcludedStation(station: StationRow) {
  const text = `${station.stationCode} ${station.stationName} ${station.trainNo} ${station.section} ${station.watering} ${station.arrival} ${station.departure}`.toLowerCase();
  return text.includes("deleted") || text.includes("via station");
}

function stationCoord(s: StationRow): [number, number] | null {
  if (Number.isFinite(s.latitude) && Number.isFinite(s.longitude)) return [s.latitude as number, s.longitude as number];
  const code = String(s.stationCode || "").trim().toUpperCase();
  const v = (fallbackStationCoordinates as Record<string, number[]>)[code];
  if (Array.isArray(v) && v.length >= 2 && Number.isFinite(Number(v[0])) && Number.isFinite(Number(v[1]))) return [Number(v[0]), Number(v[1])];
  return null;
}

const INDIA_BOUNDS: [[number, number], [number, number]] = [[7.8, 68.0], [37.2, 97.5]];
function FitBounds({ points, allPoints, selected, fitToken }: { points: [number, number][]; allPoints: [number, number][]; selected: boolean; fitToken: number }) {
  const map = useMap();
  useEffect(() => { const target = fitToken > 0 && allPoints.length ? allPoints : points; if (target.length) { map.fitBounds(target, { padding: selected && fitToken === 0 ? [45,45] : [70,70], maxZoom: selected && fitToken === 0 ? 8 : 7.5 }); return; } map.fitBounds(INDIA_BOUNDS, { padding:[12,12], maxZoom:5.6 }); }, [map, points, allPoints, selected, fitToken]);
  return null;
}
function segmentTime(station: StationRow, departureDate: Date, field: "arrival" | "departure") { const day=Number.parseInt(station.day,10); const time=station[field].match(/^(\d{1,2}):(\d{2})$/); if(!Number.isFinite(day)||!time)return null; const d=new Date(departureDate); d.setDate(d.getDate()+Math.max(0,day-1)); d.setHours(Number(time[1]),Number(time[2]),0,0); return d; }
function interpolate(a:[number,number],b:[number,number],ratio:number):[number,number]{return[a[0]+(b[0]-a[0])*ratio,a[1]+(b[1]-a[1])*ratio];}
function trainColor(index:number){const colors=["#1769aa","#8b1fc8","#0f8a67","#e07a00","#3155d8","#c43d76","#1487a8","#7356c8"];return colors[index%colors.length];}
function labelIcon(trainNo:string,color:string,selected:boolean){return new DivIcon({className:"train-map-label-wrap",html:`<div class="train-map-label ${selected?"selected":""}" style="--train-color:${color}"><span class="train-map-pulse"></span><b>${trainNo}</b></div>`,iconSize:[82,30],iconAnchor:[41,15]});}
function nextWateringStation(stations:StationRow[],currentStationName:string){const routeStations=stations.filter(s=>!isExcludedStation(s));const currentIndex=routeStations.findIndex(s=>s.stationName.trim().toLowerCase()===currentStationName.trim().toLowerCase());return routeStations.slice(currentIndex>=0?currentIndex+1:0).find(s=>s.watering?.trim())||null;}
function formatDepartureDate(date:Date){return date.toLocaleDateString("en-IN",{day:"2-digit",month:"2-digit",year:"numeric"});}

export default function RouteMap({instances,selectedKey,onTrainClick,hideAll=false,fitAllToken=0,theme="light"}:{instances:MapTrainInstance[];selectedKey:string;onTrainClick:(key:string)=>void;hideAll?:boolean;fitAllToken?:number;theme?:"light"|"dark"}){
 const routes=useMemo(()=>instances.map((instance,index)=>{
   const stations=instance.stations.filter(s=>!isExcludedStation(s));
   const geoStations=stations.map(s=>({s,coord:stationCoord(s)})).filter(x=>x.coord) as {s:StationRow;coord:[number,number]}[];
   const points=geoStations.map(x=>x.coord);
   let current:[number,number]|null=null; const solid:[number,number][][]=[]; const dotted:[number,number][][]=[];
   for(let i=0;i<geoStations.length-1;i++){const a=geoStations[i].s,b=geoStations[i+1].s;const dep=segmentTime(a,instance.departureDate,"departure"),arr=segmentTime(b,instance.departureDate,"arrival");if(!dep||!arr){dotted.push([geoStations[i].coord,geoStations[i+1].coord]);continue;}const now=new Date();if(now>=arr)solid.push([geoStations[i].coord,geoStations[i+1].coord]);else if(now<=dep)dotted.push([geoStations[i].coord,geoStations[i+1].coord]);else{const ratio=Math.max(0,Math.min(1,(now.getTime()-dep.getTime())/Math.max(1,arr.getTime()-dep.getTime())));current=interpolate(geoStations[i].coord,geoStations[i+1].coord,ratio);solid.push([geoStations[i].coord,current]);dotted.push([current,geoStations[i+1].coord]);}}
   return {instance,index,stations,geoStations,points,solid,dotted,current,color:trainColor(index)};
 }),[instances]);
 const selectedRoute=routes.find(r=>r.instance.key===selectedKey); const visibleRoutes=selectedKey?routes.filter(r=>r.instance.key===selectedKey):routes;
 const runningPoints=visibleRoutes.map(r=>{const currentStation=r.stations.find(s=>s.stationName===r.instance.currentStationName);const c=currentStation?stationCoord(currentStation):null;return c||r.current||r.points[Math.max(0,Math.min(r.points.length-1,Math.round((r.instance.percent/100)*Math.max(0,r.points.length-1))))]||null;}).filter(Boolean) as [number,number][];
 const mapFitPoints=selectedRoute?.points.length?selectedRoute.points:runningPoints;
 return <div className="real-map taptrack-map"><MapContainer center={[22.5,79]} zoom={6.2} minZoom={4.8} maxZoom={12} maxBounds={[[5.5,66.5],[38.5,99.5]]} maxBoundsViscosity={1} scrollWheelZoom className="leaflet-map"><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><FitBounds points={mapFitPoints} allPoints={runningPoints} selected={Boolean(selectedRoute)} fitToken={fitAllToken}/>{routes.map(route=><Fragment key={route.instance.key}>{route.instance.key===selectedKey&&route.solid.map((line,i)=><Polyline key={`s-${route.instance.key}-${i}`} positions={line} pathOptions={{color:route.color,weight:6,opacity:.95}}/>)}{route.instance.key===selectedKey&&route.dotted.map((line,i)=><Polyline key={`d-${route.instance.key}-${i}`} positions={line} pathOptions={{color:route.color,weight:5,opacity:.8,dashArray:"7 9"}}/>)}{route.points.length>0&&(()=>{const c=stationCoord(route.stations.find(s=>s.stationName===route.instance.currentStationName)||route.stations[0]);const markerPosition=c||route.current||route.points[Math.max(0,Math.min(route.points.length-1,Math.round((route.instance.percent/100)*(route.points.length-1))))];if(!markerPosition)return null;const nextWatering=nextWateringStation(route.instance.stations,route.instance.currentStationName);const isSelected=route.instance.key===selectedKey;if(hideAll|| (selectedKey&&!isSelected))return null;return <Marker position={markerPosition} icon={labelIcon(route.instance.trainNo,route.color,isSelected)} eventHandlers={{click:()=>onTrainClick(route.instance.key)}} zIndexOffset={isSelected?1000:200}><Tooltip direction="top" offset={[0,-16]} opacity={1} className="train-hover-tooltip"><div className="train-hover-tooltip-content"><b>Train {route.instance.trainNo}</b><span>Departure: {formatDepartureDate(route.instance.departureDate)}</span><span>Current: {route.instance.currentStationName}</span><span>Next Watering: {nextWatering?`${nextWatering.stationName} • ${nextWatering.watering}`:"None"}</span></div></Tooltip></Marker>})()}{route.instance.key===selectedKey&&route.points.map((point,i)=><CircleMarker key={`p-${route.instance.key}-${i}`} center={point} radius={4} pathOptions={{color:route.color,weight:1,fillOpacity:.85}} eventHandlers={{click:()=>onTrainClick(route.instance.key)}}/>)}</Fragment>)}</MapContainer><div className="map-overlay-legend taptrack-legend"><span><i className="solid-swatch"/> Completed</span><span><i className="dotted-swatch"/> Pending</span><span>● Click train number for route</span></div></div>;
}
