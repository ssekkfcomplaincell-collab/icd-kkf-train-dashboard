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
  latitude?: number;
  longitude?: number;
  raw: Record<string, string>;
};

export type Weekday =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export type Train = {
  trainNo: string;
  no: string;
  stations: StationRow[];
  runningDays: Record<Weekday, boolean>;
};
