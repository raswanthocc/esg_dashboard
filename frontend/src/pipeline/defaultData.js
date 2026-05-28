export const defaultData = {
  sapFuel: `Materialnummer;Materialkurztext;Werk;Menge;Mengeneinheit;Buchungsdatum;Bewegungsart
000000000001000201;HSD Diesel - Bulk;IN01;12.450,75;L;05.01.2025;101
000000000001000201;HSD Diesel - Bulk;IN01;9.832,00;L;19.01.2025;101
000000000001000202;MS Petrol Regular;IN01;1.245,50;L;12.01.2025;101
000000000001000201;HSD Diesel - Bulk;IN02;18.220,30;L;08.01.2025;101
000000000001000305;LPG Cylinders 19kg;IN02;456,000;KG;15.01.2025;101
000000000001000410;Diesel HSD Premium;DE07;5.420,80;L;22.01.2025;101
000000000001000411;Erdgas (Natural Gas);DE07;1.250,000;M3;28.01.2025;101
000000000001000201;HSD Diesel - Bulk;IN01;11.890,25;L;05.02.2025;101
000000000001000201;HSD Diesel - Bulk;IN02;15.770,90;L;10.02.2025;101
000000000001000305;LPG Cylinders 19kg;IN01;608,000;KG;14.02.2025;101
000000000001000202;MS Petrol Regular;IN01;980,45;L;20.02.2025;101
000000000001000410;Diesel HSD Premium;DE07;6.115,20;L;25.02.2025;101
000000000001000201;HSD Diesel - Bulk;US12;8.945,60;L;03.03.2025;101
000000000001000201;HSD Diesel - Bulk;IN01;13.220,55;L;07.03.2025;101
000000000001000201;HSD Diesel - Bulk;IN02;19.450,00;L;14.03.2025;101
000000000001000900;Office Stationery;IN01;125,00;EA;15.03.2025;101
000000000001000305;LPG Cylinders 19kg;IN02;532,000;KG;18.03.2025;101
000000000001000410;Diesel HSD Premium;DE07;7.220,15;L;22.03.2025;101
000000000001000411;Erdgas (Natural Gas);DE07;1.480,000;M3;28.03.2025;101
000000000001000299;Unidentified Lubricant;UNKNOWN;240,50;FU;30.03.2025;101`,

  utilityElectricity: `Meter ID,Site,Period Start,Period End,Consumption,Unit,Estimated,Tariff,Country
PUNE-MAIN-001,Pune Plant,2024-12-16,2025-01-15,184520,kWh,No,LT-IND-2A,IN
PUNE-MAIN-001,Pune Plant,2025-01-16,2025-02-15,176890,kWh,No,LT-IND-2A,IN
PUNE-MAIN-001,Pune Plant,2025-02-16,2025-03-15,198420,kWh,No,LT-IND-2A,IN
PUNE-SOLAR-01,Pune Plant,2024-12-16,2025-01-15,-22450,kWh,No,SOLAR-EXPORT,IN
PUNE-SOLAR-01,Pune Plant,2025-01-16,2025-02-15,-26830,kWh,No,SOLAR-EXPORT,IN
CHN-MAIN-001,Chennai Plant,2024-12-21,2025-01-22,212500,kWh,Yes,HT-IND-1,IN
CHN-MAIN-001,Chennai Plant,2025-01-23,2025-02-22,205870,kWh,No,HT-IND-1,IN
CHN-MAIN-001,Chennai Plant,2025-02-23,2025-03-25,219340,kWh,No,HT-IND-1,IN
CHN-EV-001,Chennai Plant,2025-01-01,2025-01-31,4820,kWh,No,LT-COM,IN
CHN-EV-001,Chennai Plant,2025-02-01,2025-02-28,5210,kWh,No,LT-COM,IN
CHN-EV-001,Chennai Plant,2025-03-01,2025-03-31,5680,kWh,No,LT-COM,IN
MUC-MAIN-001,Munich Plant,2025-01-01,2025-01-31,89.5,MWh,No,HT-IND,DE
MUC-MAIN-001,Munich Plant,2025-02-01,2025-02-28,82.1,MWh,No,HT-IND,DE
MUC-MAIN-001,Munich Plant,2025-03-01,2025-03-31,91.4,MWh,No,HT-IND,DE
ATL-MAIN-001,Atlanta Plant,2025-01-05,2025-02-04,148230,kWh,No,GP-1,US
ATL-MAIN-001,Atlanta Plant,2025-02-05,2025-03-04,135890,kWh,No,GP-1,US
ATL-MAIN-001,Atlanta Plant,2025-03-05,2025-04-04,156780,kWh,No,GP-1,US
ATL-WAREHOUSE,Atlanta Plant,2024-12-20,2025-02-22,82450,kWh,Yes,GP-1,US
PUNE-AUX-002,Pune Plant,2025-01-16,2025-02-15,8500000,kWh,No,LT-COM,IN`,

  travelConcur: `Trip ID,Traveller,Type,Date,Origin,Destination,Cabin,Nights,Distance km,City,Country,End Date
T-2025-0001,priya.s@acme.example,Flight,2025-01-08,BOM,DEL,Economy,,,,,
T-2025-0001,priya.s@acme.example,Hotel,2025-01-08,,,,2,,Delhi,IN,2025-01-10
T-2025-0001,priya.s@acme.example,Ground,2025-01-08,,,,,18,Delhi,IN,
T-2025-0001,priya.s@acme.example,Flight,2025-01-10,DEL,BOM,Economy,,,,,
T-2025-0002,rahul.k@acme.example,Flight,2025-01-14,BLR,SIN,Business,,,,,
T-2025-0002,rahul.k@acme.example,Hotel,2025-01-14,,,,3,,Singapore,SG,2025-01-17
T-2025-0002,rahul.k@acme.example,Flight,2025-01-17,SIN,BLR,Business,,,,,
T-2025-0003,maya.p@acme.example,Flight,2025-01-22,BOM,LHR,Business,,,,,
T-2025-0003,maya.p@acme.example,Hotel,2025-01-22,,,,4,,London,GB,2025-01-26
T-2025-0003,maya.p@acme.example,Flight,2025-01-26,LHR,BOM,Business,,,,,
T-2025-0004,arjun.m@acme.example,Flight,2025-02-03,DEL,DXB,Economy,,,,,
T-2025-0004,arjun.m@acme.example,Hotel,2025-02-03,,,,2,,Dubai,AE,2025-02-05
T-2025-0004,arjun.m@acme.example,Flight,2025-02-05,DXB,DEL,Economy,,,,,
T-2025-0005,leena.j@acme.example,Flight,2025-02-11,MAA,FRA,Premium Economy,,,,,
T-2025-0005,leena.j@acme.example,Hotel,2025-02-11,,,,5,,Frankfurt,DE,2025-02-16
T-2025-0005,leena.j@acme.example,Flight,2025-02-16,FRA,MAA,Premium Economy,,,,,
T-2025-0006,priya.s@acme.example,Flight,2025-02-20,BOM,DEL,Economy,,,,,
T-2025-0006,priya.s@acme.example,Rail,2025-02-21,,,,,250,Delhi,IN,
T-2025-0006,priya.s@acme.example,Flight,2025-02-22,DEL,BOM,Economy,,,,,
T-2025-0007,suresh.t@acme.example,Flight,2025-03-04,BLR,JFK,Business,,,,,
T-2025-0007,suresh.t@acme.example,Hotel,2025-03-04,,,,6,,New York,US,2025-03-10
T-2025-0007,suresh.t@acme.example,Ground,2025-03-05,,,,,55,New York,US,
T-2025-0007,suresh.t@acme.example,Flight,2025-03-10,JFK,BLR,Business,,,,,
T-2025-0008,anita.r@acme.example,Flight,2025-03-12,DEL,XXX,Economy,,,,,
T-2025-0008,anita.r@acme.example,Hotel,2025-03-12,,,,2,,Unknown,,2025-03-14
T-2025-0009,vikram.s@acme.example,Flight,2025-03-18,BOM,SFO,First,,,,,
T-2025-0009,vikram.s@acme.example,Hotel,2025-03-18,,,,4,,San Francisco,US,2025-03-22
T-2025-0009,vikram.s@acme.example,Ground,2025-03-19,,,,,,San Francisco,US,
T-2025-0009,vikram.s@acme.example,Flight,2025-03-22,SFO,BOM,First,,,,,
T-2025-0010,priya.s@acme.example,Flight,2025-03-25,BOM,HKG,Business,,,,,
T-2025-0010,priya.s@acme.example,Hotel,2025-03-25,,,,3,,Hong Kong,HK,2025-03-28
T-2025-0010,priya.s@acme.example,Flight,2025-03-28,HKG,BOM,Business,,,,,`
};
