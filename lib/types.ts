export type StationRow = {
  trainNo: string;
  stationCode: string;
  stationName: string;
  arrival: string;
  departure: string;
  day: string;
  distance: string;
  section: string;
  watering: string;
  latitude?: number;
  longitude?: number;
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
