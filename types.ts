export type StationRow = {
  no: string;
  trainNo: string;
  sno: string;
  stationCode: string;
  stationName: string;
  routeNo: string;
  arrival: string;
  departure: string;
  halt: string;
  distance: string;
  day: string;
  section: string;
  sectionKm: string;
  watering: string;
  raw: Record<string, string>;
};

export type Train = {
  trainNo: string;
  no: string;
  stations: StationRow[];
};