/**
 * Where to draw a place on the admin live globe (1062). Pure and static: no lookup service, nothing stored.
 *
 * The app only ever knows a member's approximate network place (country, maybe region and city, from CDN
 * headers; see lib/geo.ts). This turns that label into a point to draw: the city centre when the city is in the
 * table below, otherwise the country's rough centre. Coordinates are public city / country centres rounded to
 * one decimal (about 10 km), so a marker can never be more exact than "this city", and is often just "this country".
 */

export type GeoPoint = { lat: number; lng: number; precision: "city" | "country" };

// Rough geographic centres, ISO 3166-1 alpha-2. Rounded on purpose.
const COUNTRY: Record<string, [number, number]> = {
  AD: [42.5, 1.6], AE: [24, 54], AF: [33.9, 67.7], AG: [17.1, -61.8], AL: [41.2, 20.2], AM: [40.1, 45], AO: [-11.2, 17.9], AR: [-38.4, -63.6],
  AT: [47.5, 14.6], AU: [-25.3, 133.8], AZ: [40.1, 47.6], BA: [43.9, 17.7], BB: [13.2, -59.5], BD: [23.7, 90.4], BE: [50.5, 4.5], BF: [12.2, -1.6],
  BG: [42.7, 25.5], BH: [26, 50.6], BI: [-3.4, 29.9], BJ: [9.3, 2.3], BN: [4.5, 114.7], BO: [-16.3, -63.6], BR: [-14.2, -51.9], BS: [25, -77.4],
  BT: [27.5, 90.4], BW: [-22.3, 24.7], BY: [53.7, 28], BZ: [17.2, -88.5], CA: [56.1, -106.3], CD: [-4, 21.8], CF: [6.6, 20.9], CG: [-0.2, 15.8],
  CH: [46.8, 8.2], CI: [7.5, -5.5], CL: [-35.7, -71.5], CM: [7.4, 12.4], CN: [35.9, 104.2], CO: [4.6, -74.3], CR: [9.7, -83.8], CU: [21.5, -77.8],
  CV: [16, -24], CY: [35.1, 33.4], CZ: [49.8, 15.5], DE: [51.2, 10.5], DJ: [11.8, 42.6], DK: [56.3, 9.5], DM: [15.4, -61.4], DO: [18.7, -70.2],
  DZ: [28, 1.7], EC: [-1.8, -78.2], EE: [58.6, 25], EG: [26.8, 30.8], ER: [15.2, 39.8], ES: [40.5, -3.7], ET: [9.1, 40.5], FI: [61.9, 25.7],
  FJ: [-17.7, 178.1], FR: [46.2, 2.2], GA: [-0.8, 11.6], GB: [54, -2.5], GD: [12.1, -61.7], GE: [42.3, 43.4], GH: [7.9, -1], GM: [13.4, -15.3],
  GN: [9.9, -9.7], GQ: [1.7, 10.3], GR: [39.1, 21.8], GT: [15.8, -90.2], GW: [12, -15.2], GY: [4.9, -58.9], HK: [22.3, 114.2], HN: [15.2, -86.2],
  HR: [45.1, 15.2], HT: [19, -72.3], HU: [47.2, 19.5], ID: [-0.8, 113.9], IE: [53.4, -8.2], IL: [31, 34.9], IN: [21, 78.9], IQ: [33.2, 43.7],
  IR: [32.4, 53.7], IS: [64.9, -19], IT: [41.9, 12.6], JM: [18.1, -77.3], JO: [30.6, 36.2], JP: [36.2, 138.3], KE: [0, 37.9], KG: [41.2, 74.8],
  KH: [12.6, 105], KM: [-11.9, 43.9], KN: [17.4, -62.8], KR: [35.9, 127.8], KW: [29.3, 47.5], KZ: [48, 66.9], LA: [19.9, 102.5], LB: [33.9, 35.9],
  LC: [13.9, -61], LI: [47.2, 9.6], LK: [7.9, 80.8], LR: [6.4, -9.4], LS: [-29.6, 28.2], LT: [55.2, 23.9], LU: [49.8, 6.1], LV: [56.9, 24.6],
  LY: [26.3, 17.2], MA: [31.8, -7.1], MC: [43.7, 7.4], MD: [47.4, 28.4], ME: [42.7, 19.4], MG: [-18.8, 46.9], MK: [41.6, 21.7], ML: [17.6, -4],
  MM: [21.9, 95.9], MN: [46.9, 103.8], MO: [22.2, 113.5], MR: [21, -10.9], MT: [35.9, 14.4], MU: [-20.3, 57.6], MV: [3.2, 73.2], MW: [-13.3, 34.3],
  MX: [23.6, -102.6], MY: [4.2, 102], MZ: [-18.7, 35.5], NA: [-22.9, 18.5], NE: [17.6, 8.1], NG: [9.1, 8.7], NI: [12.9, -85.2], NL: [52.1, 5.3],
  NO: [60.5, 8.5], NP: [28.4, 84.1], NZ: [-40.9, 174.9], OM: [21.5, 55.9], PA: [8.5, -80.8], PE: [-9.2, -75], PG: [-6.3, 143.9], PH: [12.9, 121.8],
  PK: [30.4, 69.3], PL: [51.9, 19.1], PR: [18.2, -66.6], PS: [31.9, 35.2], PT: [39.4, -8.2], PY: [-23.4, -58.4], QA: [25.4, 51.2], RO: [45.9, 25],
  RS: [44, 21], RU: [61.5, 105.3], RW: [-1.9, 29.9], SA: [23.9, 45.1], SB: [-9.6, 160.2], SC: [-4.7, 55.5], SD: [12.9, 30.2], SE: [60.1, 18.6],
  SG: [1.35, 103.8], SI: [46.2, 15], SK: [48.7, 19.7], SL: [8.5, -11.8], SM: [43.9, 12.5], SN: [14.5, -14.5], SO: [5.2, 46.2], SR: [3.9, -56],
  SS: [6.9, 31.3], SV: [13.8, -88.9], SY: [34.8, 39], SZ: [-26.5, 31.5], TD: [15.5, 18.7], TG: [8.6, 0.8], TH: [15.9, 101], TJ: [38.9, 71.3],
  TL: [-8.9, 125.7], TM: [38.97, 59.6], TN: [33.9, 9.5], TO: [-21.2, -175.2], TR: [39, 35.2], TT: [10.7, -61.2], TW: [23.7, 121], TZ: [-6.4, 34.9],
  UA: [48.4, 31.2], UG: [1.4, 32.3], US: [39.8, -98.6], UY: [-32.5, -55.8], UZ: [41.4, 64.6], VC: [13.3, -61.2], VE: [6.4, -66.6], VN: [14.1, 108.3],
  VU: [-15.4, 166.9], WS: [-13.8, -172.1], XK: [42.6, 20.9], YE: [15.6, 48.5], ZA: [-30.6, 22.9], ZM: [-13.1, 27.8], ZW: [-19, 29.2],
  GL: [71.7, -42.6], NC: [-20.9, 165.6], PF: [-17.7, -149.4], RE: [-21.1, 55.5], GP: [16.3, -61.6], MQ: [14.6, -61], GF: [4, -53.1], GU: [13.4, 144.8],
};

// Big cities by country, keyed "CC|city" in lower case. Weighted toward where Outlly's members are (India first).
const CITY: Record<string, [number, number]> = {
  // India
  "IN|mumbai": [19.1, 72.9], "IN|delhi": [28.7, 77.1], "IN|new delhi": [28.6, 77.2], "IN|bengaluru": [13, 77.6], "IN|bangalore": [13, 77.6],
  "IN|hyderabad": [17.4, 78.5], "IN|chennai": [13.1, 80.3], "IN|kolkata": [22.6, 88.4], "IN|pune": [18.5, 73.9], "IN|ahmedabad": [23, 72.6],
  "IN|jaipur": [26.9, 75.8], "IN|surat": [21.2, 72.8], "IN|lucknow": [26.8, 80.9], "IN|kanpur": [26.4, 80.3], "IN|nagpur": [21.1, 79.1],
  "IN|indore": [22.7, 75.9], "IN|bhopal": [23.3, 77.4], "IN|patna": [25.6, 85.1], "IN|vadodara": [22.3, 73.2], "IN|ludhiana": [30.9, 75.9],
  "IN|agra": [27.2, 78], "IN|nashik": [20, 73.8], "IN|varanasi": [25.3, 83], "IN|visakhapatnam": [17.7, 83.2], "IN|vizag": [17.7, 83.2],
  "IN|vijayawada": [16.5, 80.6], "IN|vizianagaram": [18.1, 83.4], "IN|guntur": [16.3, 80.4], "IN|tirupati": [13.6, 79.4], "IN|warangal": [18, 79.6],
  "IN|coimbatore": [11, 77], "IN|madurai": [9.9, 78.1], "IN|kochi": [9.9, 76.3], "IN|thiruvananthapuram": [8.5, 76.9], "IN|kozhikode": [11.3, 75.8],
  "IN|mysuru": [12.3, 76.6], "IN|mysore": [12.3, 76.6], "IN|mangaluru": [12.9, 74.9], "IN|bhubaneswar": [20.3, 85.8], "IN|raipur": [21.3, 81.6],
  "IN|ranchi": [23.3, 85.3], "IN|guwahati": [26.1, 91.7], "IN|chandigarh": [30.7, 76.8], "IN|amritsar": [31.6, 74.9], "IN|dehradun": [30.3, 78],
  "IN|srinagar": [34.1, 74.8], "IN|noida": [28.5, 77.4], "IN|gurugram": [28.5, 77], "IN|gurgaon": [28.5, 77], "IN|ghaziabad": [28.7, 77.4],
  "IN|faridabad": [28.4, 77.3], "IN|thane": [19.2, 73], "IN|navi mumbai": [19, 73], "IN|rajkot": [22.3, 70.8], "IN|jodhpur": [26.2, 73],
  "IN|goa": [15.5, 73.8], "IN|panaji": [15.5, 73.8], "IN|kakinada": [17, 82.2], "IN|rajahmundry": [17, 81.8], "IN|nellore": [14.4, 80],
  // Rest of Asia
  "PK|karachi": [24.9, 67], "PK|lahore": [31.5, 74.3], "PK|islamabad": [33.7, 73], "BD|dhaka": [23.8, 90.4], "BD|chittagong": [22.3, 91.8],
  "NP|kathmandu": [27.7, 85.3], "LK|colombo": [6.9, 79.9], "AE|dubai": [25.2, 55.3], "AE|abu dhabi": [24.5, 54.4], "AE|sharjah": [25.3, 55.4],
  "SA|riyadh": [24.7, 46.7], "SA|jeddah": [21.5, 39.2], "QA|doha": [25.3, 51.5], "KW|kuwait city": [29.4, 48], "OM|muscat": [23.6, 58.4],
  "SG|singapore": [1.35, 103.8], "MY|kuala lumpur": [3.1, 101.7], "ID|jakarta": [-6.2, 106.8], "ID|surabaya": [-7.3, 112.7], "TH|bangkok": [13.8, 100.5],
  "VN|ho chi minh city": [10.8, 106.7], "VN|hanoi": [21, 105.8], "PH|manila": [14.6, 121], "PH|quezon city": [14.7, 121], "HK|hong kong": [22.3, 114.2],
  "CN|beijing": [39.9, 116.4], "CN|shanghai": [31.2, 121.5], "CN|shenzhen": [22.5, 114.1], "CN|guangzhou": [23.1, 113.3], "TW|taipei": [25, 121.6],
  "JP|tokyo": [35.7, 139.7], "JP|osaka": [34.7, 135.5], "KR|seoul": [37.6, 127], "KR|busan": [35.2, 129.1], "IL|tel aviv": [32.1, 34.8],
  "TR|istanbul": [41, 29], "TR|ankara": [39.9, 32.9], "IR|tehran": [35.7, 51.4], "KZ|almaty": [43.2, 76.9], "UZ|tashkent": [41.3, 69.3],
  // Europe
  "GB|london": [51.5, -0.1], "GB|manchester": [53.5, -2.2], "GB|birmingham": [52.5, -1.9], "GB|edinburgh": [56, -3.2], "GB|glasgow": [55.9, -4.3],
  "IE|dublin": [53.3, -6.3], "FR|paris": [48.9, 2.4], "FR|marseille": [43.3, 5.4], "FR|lyon": [45.8, 4.8], "DE|berlin": [52.5, 13.4],
  "DE|munich": [48.1, 11.6], "DE|hamburg": [53.6, 10], "DE|frankfurt": [50.1, 8.7], "DE|cologne": [50.9, 7], "NL|amsterdam": [52.4, 4.9],
  "NL|rotterdam": [51.9, 4.5], "BE|brussels": [50.8, 4.4], "ES|madrid": [40.4, -3.7], "ES|barcelona": [41.4, 2.2], "PT|lisbon": [38.7, -9.1],
  "IT|rome": [41.9, 12.5], "IT|milan": [45.5, 9.2], "CH|zurich": [47.4, 8.5], "CH|geneva": [46.2, 6.1], "AT|vienna": [48.2, 16.4],
  "SE|stockholm": [59.3, 18.1], "NO|oslo": [59.9, 10.8], "DK|copenhagen": [55.7, 12.6], "FI|helsinki": [60.2, 24.9], "PL|warsaw": [52.2, 21],
  "CZ|prague": [50.1, 14.4], "HU|budapest": [47.5, 19], "RO|bucharest": [44.4, 26.1], "GR|athens": [38, 23.7], "UA|kyiv": [50.5, 30.5],
  "RU|moscow": [55.8, 37.6], "RU|saint petersburg": [59.9, 30.3],
  // Americas
  "US|new york": [40.7, -74], "US|los angeles": [34.1, -118.2], "US|chicago": [41.9, -87.6], "US|houston": [29.8, -95.4], "US|phoenix": [33.4, -112.1],
  "US|philadelphia": [40, -75.2], "US|san antonio": [29.4, -98.5], "US|san diego": [32.7, -117.2], "US|dallas": [32.8, -96.8], "US|san jose": [37.3, -121.9],
  "US|austin": [30.3, -97.7], "US|san francisco": [37.8, -122.4], "US|seattle": [47.6, -122.3], "US|denver": [39.7, -105], "US|washington": [38.9, -77],
  "US|boston": [42.4, -71.1], "US|atlanta": [33.7, -84.4], "US|miami": [25.8, -80.2], "US|las vegas": [36.2, -115.1], "US|portland": [45.5, -122.7],
  "US|ashburn": [39, -77.5], "US|newark": [40.7, -74.2], "US|minneapolis": [45, -93.3], "US|detroit": [42.3, -83], "US|orlando": [28.5, -81.4],
  "CA|toronto": [43.7, -79.4], "CA|vancouver": [49.3, -123.1], "CA|montreal": [45.5, -73.6], "CA|calgary": [51, -114.1], "CA|ottawa": [45.4, -75.7],
  "MX|mexico city": [19.4, -99.1], "MX|guadalajara": [20.7, -103.3], "MX|monterrey": [25.7, -100.3], "BR|sao paulo": [-23.6, -46.6], "BR|rio de janeiro": [-22.9, -43.2],
  "BR|brasilia": [-15.8, -47.9], "AR|buenos aires": [-34.6, -58.4], "CL|santiago": [-33.4, -70.7], "CO|bogota": [4.7, -74.1], "PE|lima": [-12, -77],
  // Africa and Oceania
  "NG|lagos": [6.5, 3.4], "NG|abuja": [9.1, 7.5], "KE|nairobi": [-1.3, 36.8], "ZA|johannesburg": [-26.2, 28], "ZA|cape town": [-33.9, 18.4],
  "EG|cairo": [30, 31.2], "MA|casablanca": [33.6, -7.6], "GH|accra": [5.6, -0.2], "ET|addis ababa": [9, 38.7],
  "AU|sydney": [-33.9, 151.2], "AU|melbourne": [-37.8, 145], "AU|brisbane": [-27.5, 153], "AU|perth": [-32, 115.9], "NZ|auckland": [-36.8, 174.8],
};

/** Lower case, accents removed: "São Paulo" and "Sao Paulo" match the same row. */
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** A point to draw for a place, or null when even the country is unknown (local dev, Tor, a header-less proxy). */
export function placePoint(country: string | null | undefined, city?: string | null): GeoPoint | null {
  const cc = (country ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return null;
  if (city) {
    const c = CITY[`${cc}|${fold(city)}`];
    if (c) return { lat: c[0], lng: c[1], precision: "city" };
  }
  const k = COUNTRY[cc];
  return k ? { lat: k[0], lng: k[1], precision: "country" } : null;
}
