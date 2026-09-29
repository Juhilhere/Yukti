# MRPL: Refinery Configuration, Process Units, Infrastructure and Operations

Retrieved on 2026-09-29. Structured data is in `refinery.json`. Each fact is followed by its source. When sources disagree, all the values are listed.

Key sources:
- AR = MRPL Annual Report; AR 2025-26 = https://admin.mrpl.co.in/img/UploadedFiles/AnnualReport/Files/a4a35c19a5b64944b130274489f73963.pdf
- AR 2024-25 = https://admin.mrpl.co.in/img/UploadedFiles/AnnualReport/Files/161636e409d7464996e216b0ffbb5bba.pdf
- AR 2023-24 = https://admin.mrpl.co.in/img/UploadedFiles/AnnualReport/Files/1817d38cd9bb442080a60295fd69afd3.pdf
- AR 2022-23 = https://admin.mrpl.co.in/img/UploadedFiles/AnnualReport/Files/57014f72aa3348879567b1e7797f00ed.pdf
- EC-2023 = MoEFCC EC, 16.6 to 18.2 MMTPA = https://www.mrpl.co.in/sites/default/files/10.%20EC%20for%20Cap%20Ex%2016.6%20to%2018.2%20MMTPA%20(9.1.2023).pdf
- EC-2008 = MoEF EC for MSEZ Phase-I, including MRPL Phase-III (scanned; read visually) = https://www.mrpl.co.in/sites/default/files/3.%20EC%20for%20Phase%20-%20III%20(3.4.2008).pdf
- Units page = https://mrpl.co.in/en/Content/Manufacturing_Units

## 1. Headline configuration
- **Nameplate capacity is 15 MMTPA (about 300,000 bpd).** [src: https://www.icra.in/Rating/GetRationalReportFilePdf?id=138332]
- **Environmental clearance capacity:** "existing" capacity is 16.6 MMTPA at 8,000 h/yr (13.6 MMTPA from Phase I+II plus 3.0 MMTPA from Phase III). The EC of 09-01-2023 permits 18.2 MMTPA at 8,760 h/yr, with no revamps or new units. [src: EC-2023]
- **Consent to Operate is for 18.2 MMTPA** (FY2024-25). [src: https://mrpl.co.in/sites/default/files/Sustainability_Report/MRPL_Sustainability_report_FY_2024-25.pdf]
- **Nelson Complexity Index (conflicting values):**
  - 9.46 in the CHT/MoPNG PSU table, which is based on the OGJ Worldwide Refining & Complexity survey 2025. [src: https://cht.gov.in/refinery-complexity-index]
  - 11.67 per CareEdge (June 2025). [src: https://www.careratings.com/upload/CompanyFiles/PR/202506120619_Mangalore_Refinery_and_Petrochemicals_Limited.pdf]
  - Blogs also quote 10.6 and 11.3; these could not be traced to a primary source (low confidence).
  - The requested 10.57 did not appear in any source found.
- **Capacity history:**
  - Phase I, 1996: 3.69 MMTPA. [src: https://mrpl.co.in/en/Content/History]
  - Phase II: EC granted Aug 1996 for a 6 MTPA addition, including a 67.5 MW CPP; capacity reached 9.69 MMTPA in 1999. [src: https://www.mrpl.co.in/sites/default/files/2.%20EC%20for%20Phase%20-%20II%20(5.8.1996).pdf] [src: SR FY2024-25]
  - Nameplate re-rated from 9.69 to 11.82 MMTPA using design margins. [src: https://mrpl.co.in/en/CurrentUpdate/24]
  - EC of 23-12-2009 for expansion from 12.5 to 13.6 MMTPA: CDU-1 revamped from 3.69 to 4.8 MMTPA, GOHDS from 1.35 to 1.74 MMTPA, plus 7 new tanks. [src: https://www.mrpl.co.in/sites/default/files/4.%20EC%20for%20Diesel%20Quality%20(23.12.2009).pdf]
  - Phase III brought capacity to 15 MMTPA. The Sustainability Report dates this to 2014; ICRA says Mar 2012. [src: SR FY2024-25] [src: ICRA Oct 2025]
- **Other milestones:**
  - Incorporated 7 Mar 1988. [src: https://mrpl.co.in/en/Content/Company_Information]
  - ONGC acquired control on 28 Mar 2003. [src: https://mrpl.co.in/en/Content/History]
  - OMPL was amalgamated in 2022. [src: SR FY2024-25]
- **Location:** Mudapadav, Kuthethoor P.O., via Katipalla, Mangaluru 575030 (Kuthethoor/Bala village, Dakshina Kannada). [src: https://mrpl.co.in/en/Content/Company_Information] [src: EC-2023]
- **Land:**
  - Plant area 644.25 ha (1,592 acres), per EC-2023. [src: EC-2023]
  - The 2009 EC gave 1,425 acres. [src: EC-2009]
  - The Sustainability Report gives an operational footprint of about 2,034 acres and 699 acres of greenbelt. [src: SR FY2024-25]
- **Crude flexibility:**
  - Design range is API 24-46. [src: https://mrpl.co.in/en/Content/Profile]
  - Crudes processed to date span API 15-46. [src: AR 2025-26]

## 2. Process units
EC-2023 figures show "existing / after 18.2 MMTPA" capacity in MMTPA.

| Unit | Phase / date | Capacity | Licensor | Source |
|---|---|---|---|---|
| CDU/VDU-1 (pre-flash) | Ph I; revamped Oct 2011 | 3.69 → 4.8 MMTPA (about 5.0 by c.2018) | EIL design | [src: EC-2009] [src: PACE brief https://environmentclearance.nic.in (PACE)] |
| CDU/VDU-2 | Ph II | 7.2 MMTPA (PACE proposed 9.7; execution not confirmed) | EIL | [src: PACE brief] |
| CDU/VDU-3 | Ph III | 3.0 MMTPA design (3.3 by c.2018) | EIL PMC; Toyo/Jacobs EPC | [src: EC-2008] |
| All CDU/VDU incl. NSU | – | 16.6 / 18.2 | EIL | [src: EC-2023] |
| HCU-1 and HCU-2 | Ph I / Ph II; once-through revamp 2011/2012 | 3.36 / 3.79 combined | UOP | [src: EC-2023] [src: AR 2013-14] |
| CCR-1 and CCR-2 with NHT | Ph I / II | 0.93 / 1.06 combined | UOP | [src: EC-2023] [src: Units page] |
| Reformate Splitter | – | 0.82 / 0.94 | – | [src: EC-2023] |
| Mixed Xylene | – | 0.52 / 0.56 | – | [src: EC-2023] |
| ISOM (LNHT + Penex) | – | 0.59 (LNHT 690 / Penex 494 KTPA) | UOP Penex | [src: EC-2023] [src: PACE brief] |
| Visbreaker (Shell Soaker with vacuum flash) | Ph I/II | 0.00 / 0.02; used as DCU feed-prep | Shell / ABB Lummus | [src: Units page] [src: EC-2023] |
| Bitumen Blowing (Biturox) | Ph I; new train Nov 2024 | 0.19 MMTPA + 144 KTPA new train | Porner (Austria) | [src: EC-2023] [src: https://www.mrpl.co.in/sites/default/files/9.%20EC%20for%20Modernization%20Project%20(19.01.2021).pdf] |
| Delayed Coker | Ph III, 3 Apr 2014 | 3.0 design; 3.09 / 3.48 | Lummus Technology | [src: https://www.ogj.com/refining-processing/refining/construction/article/17272169/mrpl-starts-delayed-coker-at-mangalore-refinery] |
| PFCCU with PRU | Ph III, feed-cut 28 Aug 2014 | 2.2 design; 2.74 (PRU 0.72) | Technip Stone & Webster | [src: https://www.digitalrefining.com/news/1003078/mrpl-commissions-a-petrochemical-fluidized-catalytic-cracking-unit] |
| PFCC Wet Gas Scrubber | Commissioned FY2024-25 | 2,992 KTPA | – | [src: EC-2021] [src: AR 2024-25] |
| LPG Amine Treating (PFCC) | Modernization | 1,365 KTPA | – | [src: EC-2021] |
| CHTU (coker HGO hydrotreater) | Ph III, 2014 | 0.65 design; 1.01 | UOP Unionfining | [src: EC-2008] |
| GOHDS | Ph I/II; revamped 2009 | 1.35 → 1.74 | – | [src: EC-2009] |
| DHDT | Ph III, 2013 | 3.7 design (GOHDS+DHDT 5.32 / 5.91) | Axens | [src: EC-2008] [src: EC-2023] |
| FCC Gasoline Treating Unit | BS-VI, 11 Jul 2021 | 800 KTPA feed | Axens | [src: https://www.business-standard.com/article/news-cm/mrpl-commissions-fcc-gasoline-treatment-unit-as-part-of-its-bs-vi-project-121071201044_1.html] |
| Kero/ATF Merox; LPG Merox | – | 1.12 / 1.10; 0.22 / 0.25 | UOP | [src: EC-2023] |
| HGU-1/2 (naphtha SMR + PSA) | Ph I/II | "51.14 NM3/hr" as printed (units unclear) | KTI Holland; UOP PSA | [src: Units page] (low confidence) |
| HGU-3 | Ph III, 2013 | 70 KTPA | Haldor Topsoe | [src: EC-2008] |
| SRU (7 trains, Blocks 1-3) + TGTU | Ph I-III; SRU-7 on 28 Mar 2022 | 0.29 MMTPA S; Ph III 3×185 TPD; SRU-7 185 TPD | Claus + BSR/Selectox; TGTU by EIL with SINI | [src: Units page] [src: AR 2021-22 https://admin.mrpl.co.in/img/UploadedFiles/AnnualReport/Files/31a90f765f0a4bfca85e517a5645ed2e.pdf] |
| Polypropylene | Commercial production Jun 2015 | 440 KTPA nameplate; 0.51 MMTPA per EC | Lummus Novolen | [src: https://mrpl.co.in/en/Content/Petrochemical] |
| Aromatic complex (ex-OMPL, MSEZ) | Amalgamated 2022 | PX 914 KTPA / Bz 283 KTPA (AR); website gives 0.905 / 0.273 MMTPA | – | [src: https://mrpl.co.in/en/Content/Profile] |
| Aromatics design units | 2008 EC | NHT/CCR 0.95; Isomer 3.16; TADP 1.72; PX recovery 4.07; xylene fractionation 4.64; extraction 0.79; BT fractionation 2.2 MMTPA | not stated | [src: EC-2008] |
| Captive power | Ph II / Ph III / Aromatics | 67.5 MW; 84 MW + 606 TPH (BHEL); 60 MW | – | [src: EC-1996] [src: EC-2008] |
| Gas turbines | – | 22 MW converted to NG; 37 MW designed for NG | – | [src: AR 2023-24] |
| Steam / power | – | 2,230 TPH steam; power need 160-180 MW; 10 DG sets totalling 16,850 kVA | – | [src: EC-2017] [src: EC-2021] [src: EC-2023] |
| RLNG facility | Modernization | 0.8 MMSCMD | – | [src: AR 2023-24] |
| Desalination (Tannirbhavi) | 17 Dec 2021; expanded Feb 2024 | 30 → 40 MLD (EC allows 70) | – | [src: https://www.mrpl.co.in/sites/default/files/8._Desalination_H1_FY_2025-26.pdf] |
| WWTP-I/II/III, WAO, flare gas recovery | – | 446 m³/h discharge limit | – | [src: https://mrpl.co.in/en/Content/EMS] |
| Under construction | Targets Jan / Mar 2027 | Bio-ATF 20-33 KLPD; green H2 500 TPA | – | [src: https://mrpl.co.in/en/Content/Projects] [src: AR 2025-26] |

## 3. Infrastructure
- **SPM "Mangala-1":**
  - About 17 km offshore with a 32 m draft; handles fully laden VLCCs (300,000 t). [src: Units page]
  - Commissioned 29-08-2013 at a cost of Rs 1,044 cr. AR 2013-14 gives 16 km and 30 m draft. [src: AR 2013-14 https://admin.mrpl.co.in/img/UploadedFiles/AnnualReport/Files/28862ef4de57492d93775176b1861679.pdf]
  - Handled a record 13 VLCCs in FY2025-26. [src: AR 2025-26]
- **Port (NMPT/NMPA):**
  - Two captive jetties. [src: https://mrpl.co.in/en/Content/Profile]
  - Aromatics lines (18" PX, 16" benzene, 18" naphtha) are being moved from Jetty 13 to Jetties 10/11. A new 20" fuel-oil export line is also being laid. [src: https://mrpl.co.in/en/Content/Projects]
- **ISPRL cavern:** 760 TMT (5.586 MMbbl) of space leased in FY2025-26. [src: AR 2025-26]
- **Petronet MHB pipeline:** 363 km, Mangalore to Hassan to Devangonthi, with pumping at Hassan and Neriya. [src: Units page]
- **Devangonthi terminal:** 81 TKL storage and a 10-bay gantry; commissioned FY2024-25. [src: AR 2024-25]
- **Depots:** Hassan, Kasaragod, Hindupur and Hosur. [src: https://mrpl.co.in/en/Content/Supply_Location]
- **Tanks:** 133 tanks, including 7 Horton spheres and 7 bullets. Four HSD tanks of 30,200 KL each were added in FY2021-22. [src: Units page] [src: AR 2021-22]
- **Petcoke loading:** rail-wagon and truck loading silos. [src: https://mrpl.co.in/en/Content/Profile]
- **Water supply:**
  - A 43 km raw-water line from the Netravathi river, via the Sarpady pumping station. [src: Units page] [src: https://www.mrpl.co.in/sites/default/files/CFO_for_Sarapady_valid_till_31.12.2025.pdf]
  - Treated sewage water from MSEZL. [src: EC-2023]
- **MSEZ corridor:** about 15 km long and 70/100 m wide, linking the port to MSEZ. [src: EC-2008]
- **Aviation fuel:** Shell MRPL Aviation (50:50 JV) supplies ATF at southern airports. [src: https://mrpl.co.in/en/Content/Profile]
- **Grid connection project:** 220/33 kV link, costing Rs 385 cr. [src: https://mrpl.co.in/en/Content/Projects]

## 4. Throughput
| FY | Crude (MMT) | Utilisation | Source |
|---|---|---|---|
| 2017-18 | 16.31 | – | [src: AR 2017-18 https://admin.mrpl.co.in/img/UploadedFiles/AnnualReport/Files/6db774eedab64d40affda24b00169ab2.pdf] |
| 2018-19 | 16.23 | ~108% (computed) | [src: AR 2019-20 https://admin.mrpl.co.in/img/UploadedFiles/AnnualReport/Files/32f27c0116a244a38c94934b880ab9fc.pdf] |
| 2019-20 | 13.95 | ~93% (computed) | [src: AR 2019-20] |
| 2020-21 | 11.475 | ~76.5% (computed) | [src: AR 2020-21 https://admin.mrpl.co.in/img/UploadedFiles/AnnualReport/Files/652f4db54449453aa1166ed18f39abcd.pdf] |
| 2021-22 | 14.871 (net 15.04) | ~99% (computed) | [src: AR 2021-22] |
| 2022-23 | 17.116 | 114% | [src: AR 2022-23] |
| 2023-24 | 16.53 (CARE: 16.59) | 110% (CARE: 111%) | [src: AR 2023-24] |
| 2024-25 | 18.04 crude; 18.18 gross | 120% (CARE: 121%) | [src: AR 2024-25] [src: CARE] |
| 2025-26 | 16.774 | 111.8% | [src: AR 2025-26] |

**Distillate yield:**
- FY22: 78.79% [src: AR 2024-25]
- FY23: 78.09% [src: AR 2022-23]
- FY24: 78.77% [src: AR 2023-24]
- FY25: 81.93% [src: AR 2024-25]
- FY26: 81.94% [src: AR 2025-26]

**Fuel & loss:**
- FY23: 11.13% [src: AR 2022-23]
- FY24: 11.02% [src: AR 2023-24]
- FY25: 10.42% [src: AR 2024-25]

**Energy (MBN):**
- FY19: 74.3 [src: AR 2021-22]
- FY20: 75.33 [src: AR 2019-20]
- FY21: 81.41 [src: AR 2020-21]
- FY22: 73.45 [src: AR 2022-23]
- FY23: 71.30 (PAT-VI target was 69.08) [src: AR 2022-23]
- FY24: 71.2 [src: AR 2024-25]
- FY25: 70.71 [src: AR 2024-25]
- FY26: no MBN reported. The CCTS GHG intensity was 5.3305 against a target of 5.6885. [src: AR 2025-26]

**Water (FY25):**
- Consumption 22.13 million kL; intensity 1.23 kL/MT; 22.6% of withdrawal was desalinated water. [src: SR FY2024-25]
- The complex needs 4,003 m³/h. [src: EC-2023]

## 5. Crude basket
- The basket has 273 grades, and more than 116 grades have been processed (API 15-46). Sources span Asia, South America, Africa, the USA and Russia. [src: AR 2025-26]
- **Russian crude:**
  - About 35-40% of imports in the September 2025 quarter. [src: https://www.marketscreener.com/news/india-s-mrpl-seeks-cheaper-oil-amid-us-pressure-hopes-to-keep-buying-russian-ce7d5adfd181f121]
  - Imports stopped after the October 2025 US sanctions. By January 2026 about 40% of needs came from the Middle East. [src: https://oilprice.com/Latest-Energy-News/World-News/Indian-Refiner-MRPL-Shifts-from-Russian-to-Venezuelan-Oil-Supply.html]
- **New grades processed:**
  - FY24-25: Merey-16 (API 15.69), Peregrino (14.4), Eocene (18.1), plus Russian grades. [src: AR 2024-25]
  - FY25-26: Hout, Sarir Mesla, Gindungo, Mostarda. [src: AR 2025-26]

## 6. Shutdowns, incidents, safety
- **2019:** Force majeure in May 2019 because of water scarcity. Phase-III was shut from 18 Aug 2019 after a landslide. [src: AR 2019-20]
- **FY2023-24:** Phase-III, HCU-1 and aromatics turnaround. [src: AR 2023-24]
- **Apr-Jun 2025:** Phase-II M&I shutdown and CHTU catalyst change. [src: AR 2025-26]
- **March 2026:** About 100 kbpd of CDU and secondary units were shut during the Hormuz disruption (media report). [src: https://www.businesstoday.in/latest/corporate/story/mrpl-shuts-refining-units-as-west-asia-crude-supply-disruption-hits-operations-report-519274-2026-03-05]
- **12 Jul 2025:** H2S exposure at tank FB7029A in the Oil Movement section killed 2 people. [src: https://www.etvbharat.com/en/!state/two-workers-die-one-hospitalised-due-to-gas-leak-at-mrpl-mangaluru-enn25071203390]
  - AR 2025-26 BRSR reports 2 employee fatalities and LTIFR of 0.62 (employees) and 0.21 (workers). [src: AR 2025-26]
- **FY25:** One contract-worker fatality; contractor LTIFR 0.471. [src: SR FY2024-25]
- **Jan 2012:** SRU-II blast killed 1 person. [src: http://www.kemmannu.com/index.php?action=flashnews&type=128] (medium confidence)
- **The request mentioned 2023 fatalities, but no report of one was found.**

## 7. Digitalisation
- **ERP and AI tools:** SAP S/4HANA on cloud; AI/ML real-time optimisation with digital twins; closed-loop AI; predictive maintenance; flare analytics. [src: AR 2024-25]
- **In development:** Agentic AI and RPA. [src: AR 2025-26]
- **R&D AI applications:** CPP machine loading, CCR naphtha composition, and PP MFI/XS prediction. [src: https://mrpl.co.in/en/Content/Research_And_Development]

## Gaps / uncertainties
- No official source gives individual capacities for HCU-1 vs HCU-2, CCR-1 vs CCR-2, VBU-1/2 or HGU-1/2; the ECs give only combined figures.
- Several "design" figures come from 2008-2018 documents.
- NCI differs by source.
- The HGU capacity units on the website are ambiguous.
- No man-hours-without-LTI figure was found.
