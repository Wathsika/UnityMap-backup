/**
 * sriLankaGazetteer.js — static list of popular Sri Lanka cities & places.
 *
 * Three uses:
 *  1. STT contextual-string hints (speech recognizer bias toward these names)
 *  2. Offline/fallback candidate matching when backend search is unreachable
 *  3. Alias corrections for frequent speech-to-text mishears
 *
 * Coordinates are town-center approximations; live search results (local DB /
 * Nominatim) always win when available — this is a hint + fallback layer.
 */

export const SRI_LANKA_GAZETTEER = [
  // ── District capitals / major cities ─────────────────────────────────────
  { name: 'Colombo', aliases: ['Colombo City', 'Colombo 01', 'Colombo 07'], lat: 6.9271, lng: 79.8612, city: 'Colombo', category: 'city' },
  { name: 'Sri Jayawardenepura Kotte', aliases: ['Kotte', 'Sri Jayawardenepura', 'Administrative Capital'], lat: 6.9021, lng: 79.8853, city: 'Kotte', category: 'city' },
  { name: 'Dehiwala-Mount Lavinia', aliases: ['Mount Lavinia', 'Dehiwala', 'Dehiwala Mount Lavinia'], lat: 6.8502, lng: 79.8741, city: 'Dehiwala', category: 'city' },
  { name: 'Negombo', aliases: ['Negambo'], lat: 7.2083, lng: 79.8412, city: 'Negombo', category: 'city' },
  { name: 'Kandy', aliases: ['Kandi', 'Mahanuwara'], lat: 7.2906, lng: 80.6337, city: 'Kandy', category: 'city' },
  { name: 'Galle', aliases: ['Galle City'], lat: 6.0535, lng: 80.2210, city: 'Galle', category: 'city' },
  { name: 'Jaffna', aliases: ['Yapanaya'], lat: 9.6615, lng: 80.0255, city: 'Jaffna', category: 'city' },
  { name: 'Batticaloa', aliases: ['Batticaloa Town'], lat: 7.7136, lng: 81.6930, city: 'Batticaloa', category: 'city' },
  { name: 'Trincomalee', aliases: ['Trinco'], lat: 8.5874, lng: 81.2152, city: 'Trincomalee', category: 'city' },
  { name: 'Anuradhapura', aliases: ['Anuradapura'], lat: 8.3114, lng: 80.3867, city: 'Anuradhapura', category: 'city' },
  { name: 'Polonnaruwa', aliases: ['Polonnaruwa Town'], lat: 7.9403, lng: 81.0188, city: 'Polonnaruwa', category: 'city' },
  { name: 'Kurunegala', aliases: ['Kurunegala City'], lat: 7.4837, lng: 80.3628, city: 'Kurunegala', category: 'city' },
  { name: 'Puttalam', aliases: ['Puttalam Town'], lat: 8.0362, lng: 79.8333, city: 'Puttalam', category: 'city' },
  { name: 'Badulla', aliases: ['Badulla Town'], lat: 6.9847, lng: 81.0567, city: 'Badulla', category: 'city' },
  { name: 'Monaragala', aliases: ['Monaragala Town'], lat: 6.8714, lng: 81.3510, city: 'Monaragala', category: 'city' },
  { name: 'Ratnapura', aliases: ['Ratnapura City', 'City of Gems'], lat: 6.6828, lng: 80.4015, city: 'Ratnapura', category: 'city' },
  { name: 'Kegalle', aliases: ['Kegalle Town'], lat: 7.2513, lng: 80.3464, city: 'Kegalle', category: 'city' },
  { name: 'Matara', aliases: ['Matara Town'], lat: 5.9486, lng: 80.5353, city: 'Matara', category: 'city' },
  { name: 'Hambantota', aliases: ['Hambantota Town'], lat: 6.1244, lng: 81.1223, city: 'Hambantota', category: 'city' },
  { name: 'Ampara', aliases: ['Ampara Town'], lat: 7.1000, lng: 81.6765, city: 'Ampara', category: 'city' },
  { name: 'Kalutara', aliases: ['Kalutara Town'], lat: 6.5847, lng: 79.9626, city: 'Kalutara', category: 'city' },
  { name: 'Gampaha', aliases: ['Gampaha Town'], lat: 7.0922, lng: 79.9969, city: 'Gampaha', category: 'city' },
  { name: 'Nuwara Eliya', aliases: ['Nuwaraeliya', 'Little England'], lat: 6.9497, lng: 80.7892, city: 'Nuwara Eliya', category: 'city' },
  { name: 'Matale', aliases: ['Matale Town'], lat: 7.4677, lng: 80.6236, city: 'Matale', category: 'city' },
  { name: 'Kilinochchi', aliases: ['Kilinochchi Town'], lat: 9.3958, lng: 80.3970, city: 'Kilinochchi', category: 'city' },
  { name: 'Mullaitivu', aliases: ['Mullaitivu Town'], lat: 9.2667, lng: 80.8000, city: 'Mullaitivu', category: 'city' },
  { name: 'Vavuniya', aliases: ['Vavuniya Town'], lat: 8.7514, lng: 80.4963, city: 'Vavuniya', category: 'city' },
  { name: 'Ella', aliases: ['Ella Town'], lat: 6.8667, lng: 81.0466, city: 'Ella', category: 'city' },

  // ── Airports ─────────────────────────────────────────────────────────────
  { name: 'Bandaranaike International Airport', aliases: ['Katunayake Airport', 'Colombo Airport', 'CMB Airport'], lat: 7.1808, lng: 79.8841, city: 'Katunayake', category: 'airport' },
  { name: 'Mattala Rajapaksa International Airport', aliases: ['Mattala Airport', 'Hambantota Airport'], lat: 6.2933, lng: 81.1520, city: 'Mattala', category: 'airport' },

  // ── Railway stations ─────────────────────────────────────────────────────
  { name: 'Colombo Fort Railway Station', aliases: ['Fort Railway Station', 'Colombo Railway Station'], lat: 6.9344, lng: 79.8428, city: 'Colombo', category: 'station' },
  { name: 'Kandy Railway Station', aliases: ['Kandy Train Station'], lat: 7.2911, lng: 80.6368, city: 'Kandy', category: 'station' },
  { name: 'Galle Railway Station', aliases: ['Galle Train Station'], lat: 6.0330, lng: 80.2160, city: 'Galle', category: 'station' },
  { name: 'Jaffna Railway Station', aliases: ['Jaffna Train Station'], lat: 9.6626, lng: 80.0000, city: 'Jaffna', category: 'station' },
  { name: 'Ella Railway Station', aliases: ['Ella Train Station'], lat: 6.8673, lng: 81.0478, city: 'Ella', category: 'station' },
  { name: 'Matara Railway Station', aliases: ['Matara Train Station'], lat: 5.9480, lng: 80.5375, city: 'Matara', category: 'station' },

  // ── Hospitals ────────────────────────────────────────────────────────────
  { name: 'National Hospital of Sri Lanka', aliases: ['National Hospital Colombo', 'Colombo National Hospital'], lat: 6.9138, lng: 79.8669, city: 'Colombo', category: 'hospital' },
  { name: 'Lady Ridgeway Hospital for Children', aliases: ['LRH Colombo', 'Lady Ridgeway'], lat: 6.9177, lng: 79.8677, city: 'Colombo', category: 'hospital' },
  { name: 'Kandy General Hospital', aliases: ['Kandy Hospital'], lat: 7.2942, lng: 80.6367, city: 'Kandy', category: 'hospital' },

  // ── Universities ─────────────────────────────────────────────────────────
  { name: 'University of Colombo', aliases: ['Colombo University'], lat: 6.9067, lng: 79.8606, city: 'Colombo', category: 'university' },
  { name: 'University of Moratuwa', aliases: ['Moratuwa University'], lat: 6.7964, lng: 79.8988, city: 'Moratuwa', category: 'university' },
  { name: 'University of Peradeniya', aliases: ['Peradeniya University'], lat: 7.2567, lng: 80.5963, city: 'Peradeniya', category: 'university' },
  { name: 'University of Kelaniya', aliases: ['Kelaniya University'], lat: 6.9546, lng: 79.8930, city: 'Kelaniya', category: 'university' },

  // ── Landmarks & attractions ──────────────────────────────────────────────
  { name: 'Galle Face Green', aliases: ['Galle Face', 'Galleface', 'Gala Face'], lat: 6.9217, lng: 79.8356, city: 'Colombo', category: 'attraction' },
  { name: 'Gangaramaya Temple', aliases: ['Gangarama Temple', 'Gangarama'], lat: 6.9110, lng: 79.8555, city: 'Colombo', category: 'temple' },
  { name: 'Viharamahadevi Park', aliases: ['Viharamahadevi', 'Vihara Park'], lat: 6.9162, lng: 79.8559, city: 'Colombo', category: 'park' },
  { name: 'Independence Memorial Hall', aliases: ['Independence Square', 'Independence Commemoration Hall'], lat: 6.9064, lng: 79.8694, city: 'Colombo', category: 'attraction' },
  { name: 'Pettah Market', aliases: ['Pettah', 'Pettah Bazaar', 'Colombo Pettah'], lat: 6.9370, lng: 79.8440, city: 'Colombo', category: 'market' },
  { name: 'Dutch Hospital Shopping District', aliases: ['Dutch Hospital', 'Dutch Hospital Colombo'], lat: 6.9335, lng: 79.8439, city: 'Colombo', category: 'mall' },
  { name: 'Colombo City Centre', aliases: ['CCC Colombo'], lat: 6.9247, lng: 79.8486, city: 'Colombo', category: 'mall' },
  { name: 'One Galle Face', aliases: ['Galle Face Mall', 'OGF'], lat: 6.9213, lng: 79.8369, city: 'Colombo', category: 'mall' },
  { name: 'Sri Dalada Maligawa', aliases: ['Temple of the Tooth', 'Temple of the Tooth Relic'], lat: 7.2936, lng: 80.6416, city: 'Kandy', category: 'temple' },
  { name: 'Kandy City Centre', aliases: ['KCC Kandy'], lat: 7.2917, lng: 80.6359, city: 'Kandy', category: 'mall' },
  { name: 'Galle Fort', aliases: ['Dutch Fort Galle', 'Galle Dutch Fort'], lat: 6.0267, lng: 80.2168, city: 'Galle', category: 'attraction' },
  { name: 'Galle Face Terrace', aliases: [], lat: 6.9206, lng: 79.8360, city: 'Colombo', category: 'attraction' },
  { name: 'Sigiriya', aliases: ['Sigiriya Rock', 'Lion Rock'], lat: 7.9573, lng: 80.7603, city: 'Sigiriya', category: 'attraction' },
  { name: 'Dambulla Cave Temple', aliases: ['Dambulla Golden Temple', 'Dambulla Caves'], lat: 7.8633, lng: 80.6518, city: 'Dambulla', category: 'temple' },
  { name: 'Nine Arch Bridge', aliases: ['Nine Arch', 'Ella Nine Arch Bridge'], lat: 6.8728, lng: 81.0584, city: 'Ella', category: 'attraction' },
  { name: 'Ella Rock', aliases: ['Ella Rock Hike'], lat: 6.8675, lng: 81.0500, city: 'Ella', category: 'attraction' },
  { name: 'Yala National Park', aliases: ['Yala Park', 'Yala'], lat: 6.3717, lng: 81.4830, city: 'Yala', category: 'park' },
  { name: 'Udawalawe National Park', aliases: ['Udawalawe', 'Udawalawa'], lat: 6.4536, lng: 80.8885, city: 'Udawalawe', category: 'park' },
  { name: 'Horton Plains National Park', aliases: ['Horton Plains', 'Worlds End'], lat: 6.7967, lng: 80.8074, city: 'Nuwara Eliya', category: 'park' },
  { name: 'Jaffna Fort', aliases: ['Jaffna Dutch Fort'], lat: 9.6613, lng: 80.0020, city: 'Jaffna', category: 'attraction' },
  { name: 'Koneswaram Temple', aliases: ['Koneswaram', 'Konark Kovil'], lat: 8.5777, lng: 81.2338, city: 'Trincomalee', category: 'temple' },

  // ── Beaches ──────────────────────────────────────────────────────────────
  { name: 'Mount Lavinia Beach', aliases: ['Mount Beach'], lat: 6.8360, lng: 79.8610, city: 'Mount Lavinia', category: 'beach' },
  { name: 'Unawatuna Beach', aliases: ['Unawatuna'], lat: 6.0056, lng: 80.2478, city: 'Unawatuna', category: 'beach' },
  { name: 'Bentota Beach', aliases: ['Bentota'], lat: 6.4216, lng: 79.9687, city: 'Bentota', category: 'beach' },
  { name: 'Mirissa Beach', aliases: ['Mirissa'], lat: 5.9466, lng: 80.4700, city: 'Mirissa', category: 'beach' },
  { name: 'Arugam Bay', aliases: ['Arugamabeach', 'Arugam Bay Beach'], lat: 6.8437, lng: 81.8340, city: 'Arugam Bay', category: 'beach' },
  { name: 'Nilaveli Beach', aliases: ['Nilaveli'], lat: 8.6750, lng: 81.2160, city: 'Nilaveli', category: 'beach' },
  { name: 'Pasikuda Beach', aliases: ['Pasikuda'], lat: 7.9240, lng: 81.8300, city: 'Pasikuda', category: 'beach' },
  { name: 'Hikkaduwa Beach', aliases: ['Hikkaduwa'], lat: 6.1434, lng: 80.1110, city: 'Hikkaduwa', category: 'beach' },
  { name: 'Tangalle Beach', aliases: ['Tangalle'], lat: 6.0244, lng: 80.7920, city: 'Tangalle', category: 'beach' },
];

/** Plain names — what the STT engine gets as contextual hints. */
export const GAZETTEER_NAMES = SRI_LANKA_GAZETTEER.map((p) => p.name);

export default SRI_LANKA_GAZETTEER;
