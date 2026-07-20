# Brain review decisions vs backfilled reasoned identities

Read-only comparison report. No database writes. No changes recommended or applied.

- **Generated:** 2026-07-17T10:54:32.033Z
- **Company:** cmo8dvlc10000syx0861h1zr5
- **Decisions:** 52
- **Snapshot rows:** 91 (91 reasoned)
- **Matching:** same fingerprint basis as duration-stats (`conceptSubject` + rule-based identity → `engineeringIdentityFingerprint`)

## Summary

| Classification | Count |
|---|---|
| AGREE | 39 |
| REASONING_MORE_COMPLETE | 1 |
| DISAGREE | 12 |
| NO_REASONED_DATA | 0 |
| Decisions with no snapshot match | 0 |

## Full comparison table

| # | Classification | Concept | Status | Deliverable | Project | Decision identity | Reasoned identity | Source | Field notes | Fragnet / WBS | Activities fed to reasoning | Neighbours |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **DISAGREE** | Additional Engineering Management Works | DEVELOPER_MODIFIED | Additional Engineering Management Works | SYN1 Northvale June 2026 Programme | `project_management/project_management/coordination (type=?, stage=stage_3)` | `?/?/review (type=report, stage=stage_3)` | LLM_REASONED | engineeringWork: coordination vs review (DISAGREE)<br>deliverableType: null -> report (more specific) | EW-001 - Review Additional Works | Produce M&T report and Update specs<br>Produce Hazard Log + Class 3 Risk Assessment<br>Undertake BWIC Co-ordination | Additional Structural Works<br>Additional Ground Investigation<br>Additional Drainage Works |
| 2 | **AGREE** | Additional Ground Investigation | DEVELOPER_MODIFIED | Additional Ground Investigation | SYN1 Northvale June 2026 Programme | `ground_investigation/?/inspection (type=report, stage=stage_3)` | `?/?/inspection (type=report, stage=stage_3)` | LLM_REASONED | — | EW-001 - Review Additional Works | Specify additional Ground Investigation<br>Mobilise Ground Investigation (By others)<br>Fielworks Ground Investigation (By others)<br>Lab Testing Ground Investigation (By others)<br>GET- Confirmation from client to proceed with spec<br>Produce GIR | Additional Structural Works<br>Additional Engineering Management Works<br>Additional Drainage Works |
| 3 | **DISAGREE** | Additional Structural Works | DEVELOPER_MODIFIED | Additional Structural Works | SYN1 Northvale June 2026 Programme | `structural/?/coordination (type=?, stage=stage_3)` | `structural/slabs/review (type=report, stage=stage_3)` | LLM_MERGED | engineeringObject: null -> slabs (more specific)<br>engineeringWork: coordination vs review (DISAGREE)<br>deliverableType: null -> report (more specific) | EW-001 - Review Additional Works | Produce Specification for Link Structure Surveys<br>Remove Movement Joint<br>Update transfer slab thickness<br>Update cantilever screen support<br>Coordinate masonry supports<br>Review & update structure to accomodate shower recesses<br>Update Slab Thickenings<br>Canopy Update - Level 07<br>Update entrance area structure<br>WD Request for Link Structure foundation assessment<br>MMD conducts scoping exercise for Link structure foundations<br>Retrack the Ambulance bay<br>GET - Receive Ambulance Bay info from Trust<br>VI - 016 Ambulance Bay Tracking Documentation<br>GET - Receive comments on Cantilever Screen Support from Design Team<br>GET - Masonry support details from specialist | Additional Ground Investigation<br>Additional Engineering Management Works<br>Additional Drainage Works |
| 4 | **AGREE** | Ambulance Bay Canopy | DEVELOPER_MODIFIED | Ambulance Bay Canopy | SYN1 Northvale June 2026 Programme | `structural/steelwork/detailing (type=drawing, stage=stage_3)` | `structural/steelwork/detailing (type=drawing, stage=stage_3)` | LLM_REASONED | — | Secondary Steelwork | Secondary steelwork drawings - Ambulance bay canopy<br>Wilmott Dixon Review Secondary Steelwork Drawings<br>Update & Reissue Secondary Steelwork Drawings<br>GET - Formal Acceptance of Secondary Steelwork Drawings - Ambulance bay canopy | Partitions<br>Elevations<br>Ceilings<br>Detailed Design |
| 5 | **AGREE** | Architectural Setting Out | DEVELOPER_MODIFIED | Architectural Setting Out | SYN1 Northvale June 2026 Programme | `project_management/project_management/detailing (type=drawing, stage=stage_3)` | `?/?/detailing (type=drawing, stage=stage_3)` | LLM_MERGED | — | GET Milestones | GET - Architectural Setting out of Upstands & Slab Edges - Level 6<br>GET - Architectural Setting out of Upstands & Slab Edges - Level 7<br>GET - Architectural Setting out of Upstands & Slab Edges - Level 8<br>GET - Architectural Setting out of Upstands & Slab Edges - Level 9<br>GET - Architectural Setting out of Upstands & Slab Edges - Level 10<br>GET - Architectural Setting out of Upstands & Slab Edges - Level 11<br>GET - Architectural Setting out of Upstands & Slab Edges - Level 12<br>GET -Architectural Details for Contractor Proposal drawings<br>GET - Updated architectural Setting out of Upstands & Slab Edges - Level 6<br>GET - Updated architectural Setting out of Upstands & Slab Edges - Level 7<br>GET - Updated architectural Setting out of Upstands & Slab Edges - Level 9<br>GET - Updated architectural Setting out of Upstands & Slab Edges - Level 8 | Drainage<br>Link Structure Survey<br>GI<br>Equipment Specifications<br>BWIC<br>Enabling Works |
| 6 | **AGREE** | BWIC | DEVELOPER_MODIFIED | BWIC | SYN1 Northvale June 2026 Programme | `project_management/project_management/coordination (type=milestone, stage=stage_3)` | `?/?/coordination (type=milestone, stage=stage_3)` | LLM_MERGED | — | GET Milestones | GET Final BWIC Locations & Sizes & Plant Weights - Level 6<br>GET Final BWIC Locations & Sizes & Plant Weights - Level 7<br>GET Final BWIC Locations & Sizes & Plant Weights - Level 8<br>GET Final BWIC Locations & Sizes & Plant Weights - Level 9<br>GET Final BWIC Locations & Sizes & Plant Weights - Level 10<br>GET Final BWIC Locations & Sizes & Plant Weights - Level 11<br>GET Final BWIC Locations & Sizes & Plant Weights - Level 12<br>GET Final BWIC locations through walls | Drainage<br>Link Structure Survey<br>GI<br>Equipment Specifications<br>Enabling Works<br>Architectural Setting Out |
| 7 | **AGREE** | CE-015 GL6 Foundation Alteration Feasibility — Work package | DEVELOPER_MODIFIED | CE-015 GL6 Foundation Alteration Feasibility — Work package | SYN1 Northvale June 2026 Programme | `structural/foundations/design (type=?, stage=stage_3)` | `structural/foundations/design (type=?, stage=stage_3)` | LLM_REASONED | — | CE-015 GL6 Foundation Alteration Feasibility | Receive survey information for existing GL6 Foundations<br>Additional GI<br>Design options for GL6 Foundations alterations<br>Agree option for GL6 Foundations<br>Final Design and detailing for GL6 Foundations | *(none)* |
| 8 | **AGREE** | Ceilings | DEVELOPER_MODIFIED | Ceilings | SYN1 Northvale June 2026 Programme | `structural/steelwork/detailing (type=drawing, stage=stage_3)` | `structural/steelwork/detailing (type=drawing, stage=stage_3)` | LLM_REASONED | — | Secondary Steelwork | Secondary steelwork drawings - Theatre ceilings<br>Wilmott Dixon Review Secondary Steelwork Drawings<br>Update & Reissue Secondary Steelwork Drawings<br>GET - Formal Acceptance of Secondary Steelwork Drawings - Theatre ceilings | Partitions<br>Ambulance Bay Canopy<br>Elevations<br>Detailed Design |
| 9 | **AGREE** | Contract Award — Work package | DEVELOPER_MODIFIED | Contract Award — Work package | SYN1 Northvale June 2026 Programme | `project_management/project_management/milestone (type=milestone, stage=stage_3)` | `project_management/project_management/milestone (type=milestone, stage=stage_3)` | LLM_REASONED | — | Contract Award | Confirmation of contract award<br>Agreed scope | *(none)* |
| 10 | **DISAGREE** | Design (Developed Design Report - MEP) | DEVELOPER_MODIFIED | New Design Specification - MEP | Leighton Hospital | `mechanical/mechanical_systems/design (type=report, stage=developed_design)` | `mechanical/mechanical_systems/design (type=specification, stage=?)` | LLM_REASONED | deliverableType: report vs specification (DISAGREE)<br>variant (1×, DISAGREE): mechanical/mechanical_systems/design (type=specification, stage=?) — deliverableType: report vs specification (DISAGREE)<br>variant (2×, AGREE): mechanical/mechanical_systems/design (type=report, stage=?) | Combined MEP Services | NBS MEP Specification | Developed Design Report - MEP<br>New Design Schematics - MEP<br>Developed Design Drawing - MEP<br>Updated Technical Note - MEP<br>New 3D Model - MEP<br>New Design Schedule - MEP |
| 11 | **AGREE** | Design Schematics (New Design Schematics - Mechanical) | DEVELOPER_MODIFIED | New Design Schematics - MEP | Leighton Hospital | `mechanical/mechanical_systems/design (type=drawing, stage=stage_2)` | `?/?/design (type=drawing, stage=?)` | LLM_MERGED | variant (1×, AGREE): ?/?/design (type=drawing, stage=?)<br>variant (2×, AGREE): mechanical/mechanical_systems/design (type=drawing, stage=?) | Combined MEP Services | Fire Hydrants Schematic<br>Above Ground Drainage Schematics - Cluster 1-13<br>Above Ground Drainage Schematics - Hub<br>GA Plans Primary Pipework Distribution Schematics - CSSD Building<br>GA Plans Primary Pipework Distribution Schematics - Main Building | New Design Specification - MEP<br>Developed Design Report - MEP<br>Developed Design Drawing - MEP<br>Updated Technical Note - MEP<br>New 3D Model - MEP<br>New Design Schedule - MEP |
| 12 | **AGREE** | Detailed Design (core) | DEVELOPER_MODIFIED | Detailed Design | SYN1 Northvale June 2026 Programme | `structural/core/design (type=?, stage=stage_3)` | `structural/core/design (type=?, stage=stage_3)` | LLM_MERGED | — | Structural Design | Column design<br>Wall design<br>Update core riser openings | Core General Arrangements<br>Column Elevations<br>Wall Elevations<br>Structural Design — Work package<br>Reinforcement Detailing<br>Model/Drawing Development |
| 13 | **AGREE** | Detailed Design (drainage) | DEVELOPER_MODIFIED | Detailed Design | SYN1 Northvale June 2026 Programme | `civil/drainage/design (type=?, stage=stage_3)` | `civil/drainage/design (type=?, stage=stage_3)` | LLM_MERGED | — | Drainage Design | Drainage design | Model/Drawing Development |
| 14 | **AGREE** | Detailed Design (foundations) | DEVELOPER_MODIFIED | Detailed Design | SYN1 Northvale June 2026 Programme | `structural/foundations/design (type=?, stage=stage_3)` | `structural/foundations/design (type=?, stage=stage_3)` | LLM_MERGED | — | Foundations | Agree vertical loads<br>Calculate wind and notional loads<br>Detailed load-take-down<br>Stability Analysis<br>Foundation analysis and design | Reinforcement Detailing<br>Model Drawing/Development |
| 15 | **AGREE** | Detailed Design (link bridge) | DEVELOPER_MODIFIED | Detailed Design | SYN1 Northvale June 2026 Programme | `structural/link_bridge/design (type=?, stage=stage_3)` | `structural/link_bridge/design (type=?, stage=stage_3)` | LLM_MERGED | — | Link Structure | GET - Confirmed Link Structure Design Option<br>Link Structure Options Study | VI-061 Confirmation of Link Bridge 'Option 2' as preferred design solution<br>VI-019 Desktop Study - Link Bridge Foundations<br>VI-052 Link Bridge - Option 1 (Early Stage 3 Structural Analysis)<br>VI-046 Link Bridge Surveys |
| 16 | **DISAGREE** | Detailed Design (slabs, Level 9) | DEVELOPER_MODIFIED | Detailed Design | SYN1 Northvale June 2026 Programme | `structural/slabs/design (type=?, stage=stage_3)` | `structural/slabs/analysis (type=analysis, stage=stage_3)` | LLM_MERGED | engineeringWork: design vs analysis (DISAGREE)<br>deliverableType: null -> analysis (more specific)<br>variant (2×, DISAGREE): structural/slabs/analysis (type=analysis, stage=stage_3) — engineeringWork: design vs analysis (DISAGREE); deliverableType: null -> analysis (more specific)<br>variant (2×, REASONING_MORE_COMPLETE): structural/slabs/design (type=milestone, stage=stage_3) — deliverableType: null -> milestone (more specific)<br>variant (1×, AGREE): ?/slabs/design (type=?, stage=stage_3)<br>variant (1×, AGREE): structural/slabs/design (type=?, stage=stage_3) | Level 12 | Slab analysis - Level 12 | Model/Drawing Development<br>Reinforcement Detailing |
| 17 | **AGREE** | Detailed Design (steelwork) | DEVELOPER_MODIFIED | Detailed Design | SYN1 Northvale June 2026 Programme | `structural/steelwork/design (type=drawing, stage=stage_3)` | `structural/steelwork/design (type=drawing, stage=stage_3)` | LLM_MERGED | — | Secondary Steelwork | Secondary steelwork design - theatre ceilings<br>Secondary steelwork design - partitions<br>Secondary steelwork design - elevations<br>Secondary steelwork design - Ambulance bay canopy<br>GET - Architectural Partition Layout<br>GET - RPA and BWIC info to release theatre steelwork design<br>GET - Peads link corridor canopy interface strategy confirmation<br>Update Secondary steelwork design - partitions<br>Update Secondary steelwork design - elevations (blast louvres)<br>Theatre ceiling coordination | Partitions<br>Ambulance Bay Canopy<br>Elevations<br>Ceilings |
| 18 | **AGREE** | Detailed Design (walls/slabs, Level 7) | DEVELOPER_MODIFIED | Detailed Design | SYN1 Northvale June 2026 Programme | `structural/slabs/design (type=?, stage=stage_3)` | `?/slabs/design (type=?, stage=stage_3)` | LLM_MERGED | — | Level 7 | Slab analysis - Level 07<br>GET - Curtain wall deflection tolerance update | Model/Drawing Development<br>Reinforcement Detailing |
| 19 | **AGREE** | Developed Design Drawing - Electrical | DEVELOPER_APPROVED | Developed Design Drawing - Electrical | Leighton Hospital | `electrical/electrical_systems/design (type=design_drawing, stage=?)` | `electrical/electrical_systems/design (type=design_drawing, stage=?)` | LLM_REASONED | — | Electrical Services | Sitewide HV Ring Networks (1:1000)<br>Generator House & HV Intake Layout & Schematic (1:100)<br>Generator Room Arrangement (1:50)<br>Main Switchroom & UPS Room Layout (1:30)<br>Switchroom & Riser Layouts (1:40)<br>Main Building Security Zoning<br>Containment Strategy - Level 00 - Sheets 1-4 (1:100)<br>Containment Strategy - Level 01 - Sheets 1-4 (1:100)<br>Containment Strategy - Level 02 - Sheets 1-4 (1:100)<br>Containment Strategy - Level 05 - Sheet 2 & 3 (1:100)<br>LV Distribution Site Layout (1:1000)<br>Distribution Zoning Strategy Layout - Level 00 - Sheets 1-4 (1:100)<br>Distribution Zoning Strategy Layout - Level 01 - Sheets 1-4 (1:100)<br>Distribution Zoning Strategy Layout - Level 02 - Sheets 1-4 (1:100)<br>Distribution Zoning Strategy Layout - Level 03 - Sheets 1-4 (1:100)<br>Distribution Zoning Strategy Layout - Level 04 - Sheets 1-4 (1:100)<br>Distribution Zoning Strategy Layout - Level 05 - Sheets 1-4 (1:100)<br>Main Switch Gear & Distribution Routes Dwgs 4 Sheets<br>Lighting Strategy Layout Sheets 1 & 2 (1:100)<br>Lighting Strategy Layout Sheet 1 of 1 (1:100) 2<br>Lighting Strategy Layout Sheet 1 of 1 (1:100) 3<br>Lighting Strategy Layout Sheet 1 of 1 (1:100) 4<br>Lighting Strategy Layout Sheet 1 of 1 (1:100) 5<br>Lighting Strategy Layout Sheet 1 of 1 (1:100) 6<br>Lightning Protection Dwg 2 Sheets (1:400)<br>Sitewide External Lighting Philosophy (1:1000) | New Design Schematics - Electrical<br>Updated Technical Note - Electrical<br>Developed Design Schematics - Electrical<br>Developed Design Schedule - Electrical |
| 20 | **AGREE** | Developed Design Drawing - MEP | DEVELOPER_APPROVED | Developed Design Drawing - MEP | Leighton Hospital | `mechanical/plant_room/design (type=design_drawing, stage=?)` | `mechanical/plant_room/design (type=design_drawing, stage=?)` | LLM_REASONED | — | Combined MEP Services | External Services Layout (1:1000)<br>CSSD Plantroom (1:100)<br>Cluster 01-A & 01-B Plantrooms (1:100)<br>Cluster 02-A & 03-A Plantrooms (1:100)<br>Cluster 04-A & 04-B Plantrooms (1:100)<br>Cluster 05-A & 05-B Plantrooms (1:100)<br>Cluster 06-A & 06-B Plantrooms (1:100)<br>Cluster 07-A Plantrooms (1:100)<br>Cluster 09-A & 09-B Plantrooms (1:100)<br>Cluster 11-A & 11-B Plantrooms (1:100)<br>Cluster 12-A & 12-B Plantrooms (1:100)<br>Cluster 13-A & 13-B Plantrooms (1:100)<br>Cluster 06-A & 09-A Plantrooms (1:100)<br>Cluster 01-A & 04-A Plantrooms (1:100)<br>Cluster 11-A & 13-A Plantrooms (1:100)<br>Energy Centre-A & B Plantrooms (1:100)<br>Generator House-A & B Plantrooms (1:100)<br>Med Gas Manifold Plantrooms (1:100)<br>Shallow Geothermal Closed Loop Borehole Array 1:1000<br>Energy Strategy Report | New Design Specification - MEP<br>Developed Design Report - MEP<br>New Design Schematics - MEP<br>Updated Technical Note - MEP<br>New 3D Model - MEP<br>New Design Schedule - MEP |
| 21 | **AGREE** | Developed Design Schedule - Electrical | DEVELOPER_MODIFIED | Developed Design Schedule - Electrical | Leighton Hospital | `electrical/electrical_systems/design (type=schedule, stage=?)` | `electrical/electrical_systems/design (type=schedule, stage=?)` | LLM_REASONED | — | Electrical Services | Internal Lighting Luminaire Schedule | New Design Schematics - Electrical<br>Updated Technical Note - Electrical<br>Developed Design Schematics - Electrical<br>Developed Design Drawing - Electrical |
| 22 | **AGREE** | Developed Design Schedule - Mechanical | DEVELOPER_MODIFIED | Developed Design Schedule - Mechanical | Leighton Hospital | `mechanical/mechanical_systems/design (type=schedule, stage=?)` | `mechanical/mechanical_systems/design (type=schedule, stage=?)` | LLM_REASONED | — | Mechanical Services | AHU Resiliency Strategy<br>Medical Gas Requirements Room Matrix | New Design Schematics - Mechanical<br>Developed Design Report - Mechanical<br>Developed Design Schematics - Mechanical<br>Updated Technical Note - Mechanical |
| 23 | **AGREE** | Developed Design Schematics - Electrical | DEVELOPER_MODIFIED | New Design Schematics - Electrical | Leighton Hospital | `electrical/electrical_systems/design (type=drawing, stage=?)` | `electrical/electrical_systems/design (type=drawing, stage=?)` | LLM_REASONED | — | Electrical Services | Fire Alarm Schematic - CSSD Building<br>CSSD Building Security System Schematic<br>Containment Strategy - Sheet 1 (1:100)<br>Distribution Zoning Strategy Layout<br>Main Switch Gear & Distribution Routes Dwgs<br>Lighting Strategy Layout Sheet 1 of 1 (1:100)<br>Lightning Protection Dwg (1:400) | Updated Technical Note - Electrical<br>Developed Design Schematics - Electrical<br>Developed Design Schedule - Electrical<br>Developed Design Drawing - Electrical |
| 24 | **AGREE** | Drainage | DEVELOPER_MODIFIED | Drainage | SYN1 Northvale June 2026 Programme | `public_health/drainage/coordination (type=milestone, stage=stage_3)` | `public_health/drainage/coordination (type=milestone, stage=stage_3)` | LLM_MERGED | — | GET Milestones | GET Receive drainage pop-up locations & flow rates from SDS | Link Structure Survey<br>GI<br>Equipment Specifications<br>BWIC<br>Enabling Works<br>Architectural Setting Out |
| 25 | **AGREE** | Due Diligence — Work package | DEVELOPER_MODIFIED | Due Diligence — Work package | SYN1 Northvale June 2026 Programme | `project_management/project_management/review (type=report, stage=stage_3)` | `project_management/project_management/review (type=report, stage=stage_3)` | LLM_REASONED | — | Due Diligence | Stability Analysis Review<br>Slab Analysis review<br>Load-take down / Colum / Foundation review<br>Model review<br>Geotechnical information review<br>Civil engineering information review<br>Due-diligence report submission<br>Review DD works with WD / UHP<br>Undertake Onboarding | *(none)* |
| 26 | **AGREE** | Enabling Works | DEVELOPER_MODIFIED | Enabling Works | SYN1 Northvale June 2026 Programme | `project_management/project_management/milestone (type=milestone, stage=stage_3)` | `project_management/project_management/milestone (type=milestone, stage=stage_3)` | LLM_REASONED | — | GET Milestones | GET Enabling Works Information | Drainage<br>Link Structure Survey<br>GI<br>Equipment Specifications<br>BWIC<br>Architectural Setting Out |
| 27 | **AGREE** | Equipment Specifications | DEVELOPER_MODIFIED | Equipment Specifications | SYN1 Northvale June 2026 Programme | `project_management/project_management/design (type=specification, stage=stage_3)` | `?/?/design (type=specification, stage=stage_3)` | LLM_MERGED | — | GET Milestones | GET Imaging Equipment Specifications | Drainage<br>Link Structure Survey<br>GI<br>BWIC<br>Enabling Works<br>Architectural Setting Out |
| 28 | **AGREE** | External Finishes Works — Work package | DEVELOPER_MODIFIED | External Finishes Works — Work package | SYN1 Northvale June 2026 Programme | `?/?/detailing (type=design_drawing, stage=stage_3)` | `?/?/detailing (type=design_drawing, stage=stage_3)` | LLM_REASONED | — | External Finishes Works | Produce draft plan drawings<br>Coordinate with architecture team<br>Produce detailed drawings with typical details<br>Issue to Wilmott Dixon<br>GET - External works drawings from  Architect | *(none)* |
| 29 | **AGREE** | GI | DEVELOPER_MODIFIED | GI | SYN1 Northvale June 2026 Programme | `project_management/project_management/milestone (type=milestone, stage=stage_3)` | `project_management/project_management/milestone (type=milestone, stage=stage_3)` | LLM_REASONED | — | GET Milestones | GET Additional GI | Drainage<br>Link Structure Survey<br>Equipment Specifications<br>BWIC<br>Enabling Works<br>Architectural Setting Out |
| 30 | **DISAGREE** | MMD/Client Programme Alignment - Prolongation | DEVELOPER_MODIFIED | MMD/Client Programme Alignment - Prolongation | SYN1 Northvale June 2026 Programme | `project_management/project_management/coordination (type=programme, stage=stage_3)` | `project_management/project_management/review (type=programme, stage=stage_3)` | LLM_REASONED | engineeringWork: coordination vs review (DISAGREE) | Change | Programme Prolongation | *(none)* |
| 31 | **AGREE** | Model Development (Level 7) | DEVELOPER_MODIFIED | Model/Drawing Development | SYN1 Northvale June 2026 Programme | `structural/?/general_arrangement (type=drawing, stage=stage_3)` | `?/?/general_arrangement (type=drawing, stage=stage_3)` | LLM_MERGED | — | Level 7 | General Arrangement - Level 07<br>Wilmott Dixon Review Level 07 General Arrangement Drawings<br>Update & Reissue General Arrangement Drawings<br>GET - Formal Acceptance of Level 07 General Arrangement Drawings | Reinforcement Detailing<br>Detailed Design |
| 32 | **AGREE** | Model Drawing/Development (foundations) | DEVELOPER_APPROVED | Model Drawing/Development | SYN1 Northvale June 2026 Programme | `structural/foundations/general_arrangement (type=general_arrangement, stage=stage_3)` | `structural/foundations/general_arrangement (type=general_arrangement, stage=stage_3)` | LLM_MERGED | — | Foundations | Foundation General Arrangement Drawings<br>Wilmott Dixon Review Foundation General Arrangement Drawings<br>Update & Reissue General Arrangement Drawings<br>GET - Formal Acceptance of Foundation General Arrangement Drawings | Detailed Design<br>Reinforcement Detailing |
| 33 | **AGREE** | Model/Drawing Development (drainage) | DEVELOPER_APPROVED | Model/Drawing Development | SYN1 Northvale June 2026 Programme | `public_health/drainage/design (type=design_drawing, stage=stage_3)` | `public_health/drainage/design (type=design_drawing, stage=stage_3)` | LLM_MERGED | — | Drainage Design | Develop drainage design drawings and issue | Detailed Design |
| 34 | **AGREE** | Model/Drawing Development (Structural Design) | DEVELOPER_APPROVED | Model/Drawing Development | SYN1 Northvale June 2026 Programme | `structural/?/design (type=drawing, stage=stage_3)` | `structural/?/design (type=drawing, stage=stage_3)` | LLM_MERGED | — | Structural Design | Front end-guidance strategy drawings<br>Loading Plans etc | Core General Arrangements<br>Column Elevations<br>Wall Elevations<br>Structural Design — Work package<br>Reinforcement Detailing<br>Detailed Design |
| 35 | **AGREE** | New Design Drawing - Public Health | DEVELOPER_APPROVED | New Design Drawing - Public Health | Leighton Hospital | `public_health/drainage/detailing (type=design_drawing, stage=?)` | `public_health/drainage/detailing (type=design_drawing, stage=?)` | LLM_MERGED | — | Public Health Services | Details Standard Drainage (One sheet) | Updated Technical Note - Public Health |
| 36 | **AGREE** | New Design Report - Acoustics | DEVELOPER_MODIFIED | New Design Report - Acoustics | Leighton Hospital | `acoustics/acoustics/design (type=report, stage=?)` | `acoustics/acoustics/design (type=report, stage=?)` | LLM_REASONED | — | Acoustics | RIBA Stage Acoustic Strategy Report | New Technical Note - Acoustics |
| 37 | **AGREE** | New Design Report - Fire Safety Engineering | DEVELOPER_MODIFIED | New Design Report - Fire Safety Engineering | Leighton Hospital | `fire_engineering/fire_safety/design (type=report, stage=?)` | `fire_engineering/fire_safety/design (type=report, stage=?)` | LLM_REASONED | — | Fire Safety Engineering | RIBA Stage Fire Strategy Report | New Technical Note - Fire Safety Engineering |
| 38 | **AGREE** | New Technical Note - Acoustics | DEVELOPER_APPROVED | New Technical Note - Acoustics | Leighton Hospital | `acoustics/acoustics/analysis (type=technical_note, stage=?)` | `acoustics/acoustics/analysis (type=technical_note, stage=?)` | LLM_MERGED | — | Acoustics | Atrium acoustic absorption for reverberation - calcs in a model | New Design Report - Acoustics |
| 39 | **DISAGREE** | Partitions | DEVELOPER_MODIFIED | Partitions | SYN1 Northvale June 2026 Programme | `structural/steelwork/detailing (type=drawing, stage=stage_3)` | `structural/steelwork/detailing (type=design_drawing, stage=stage_3)` | LLM_REASONED | deliverableType: drawing vs design_drawing (DISAGREE) | Secondary Steelwork | Secondary steelwork drawings - partitions<br>Wilmott Dixon Review Secondary Steelwork Drawings<br>Update & Reissue Secondary Steelwork Drawings<br>GET - Formal Acceptance of Secondary Steelwork Drawings - partitions<br>GET - Confirmation of pressure stabiliser vent positions | Ambulance Bay Canopy<br>Elevations<br>Ceilings<br>Detailed Design |
| 40 | **AGREE** | Report - Sustainability - BREEAM | DEVELOPER_MODIFIED | Report - Sustainability - BREEAM | Leighton Hospital | `sustainability/?/calculation (type=report, stage=?)` | `?/?/? (type=report, stage=?)` | LLM_REASONED | — | Sustainability | BREEAM Stage 3 Summary Report<br>Mat 06 RIBA 2 Material Efficiency Report<br>MAT 05 Design for Durability & Resiliance | Report - Sustainability - Net Zero Carbon<br>Report - Sustainability - Environment / Sustainability |
| 41 | **DISAGREE** | Report - Sustainability - Environment / Sustainability | DEVELOPER_MODIFIED | Report - Sustainability - Environment / Sustainability | Leighton Hospital | `sustainability/?/modelling (type=report, stage=?)` | `sustainability/?/analysis (type=report, stage=?)` | LLM_REASONED | engineeringWork: modelling vs analysis (DISAGREE) | Sustainability | Operational Energy Modelling Report (TM-54)<br>Thermal Comfort<br>Indoor Air quality Plan | Report - Sustainability - Net Zero Carbon<br>Report - Sustainability - BREEAM |
| 42 | **DISAGREE** | Report - Sustainability - Net Zero Carbon | DEVELOPER_MODIFIED | Report - Sustainability - Net Zero Carbon | Leighton Hospital | `sustainability/?/calculation (type=report, stage=?)` | `?/?/analysis (type=report, stage=?)` | LLM_REASONED | engineeringWork: calculation vs analysis (DISAGREE) | Sustainability | Net Zero Carbon summary report<br>NHS NZC WLC Toolkit 1&2<br>NHS NZC OEC Toolkit 1&2<br>NHS NZC Design Management Tool 1&2 | Report - Sustainability - Environment / Sustainability<br>Report - Sustainability - BREEAM |
| 43 | **DISAGREE** | Retired Activities — Work package | DEVELOPER_MODIFIED | Retired Activities — Work package | SYN1 Northvale June 2026 Programme | `structural/link_bridge/detailing (type=drawing, stage=stage_3)` | `structural/link_bridge/design (type=general_arrangement, stage=stage_3)` | LLM_REASONED | engineeringWork: detailing vs design (DISAGREE)<br>deliverableType: drawing vs general_arrangement (DISAGREE) | Retired Activities | Masonry / lintel detailing<br>Development of model and sheets<br>Detailed connection intent for precast wall panels<br>Assess existing structure for support of new link structure<br>Design & analysis of new link structure steelwork<br>Produce Link Structure General Arrangement Drawings<br>Wilmott Dixon Review Link Structure General Arrangement Drawings<br>Update & Reissue Link Structure Drawings<br>GET - Formal Acceptance of Link Structure General Arrangement Drawings<br>Produce Reinforcement Detailing for Composite Slabs<br>Link Structure Reinforcement Drawings Released<br>Liaise with LLFA regarding increase in discharge rate | *(none)* |
| 44 | **AGREE** | Structural Design — Work package | DEVELOPER_APPROVED | Structural Design — Work package | SYN1 Northvale June 2026 Programme | `structural/?/design (type=?, stage=stage_3)` | `structural/?/design (type=?, stage=stage_3)` | LLM_REASONED | — | Structural Design | CP Drawings Issue | Core General Arrangements<br>Column Elevations<br>Wall Elevations<br>Reinforcement Detailing<br>Detailed Design<br>Model/Drawing Development |
| 45 | **DISAGREE** | Updated Technical Note - Electrical | DEVELOPER_APPROVED | Updated Technical Note - Electrical | Leighton Hospital | `electrical/electrical_systems/technical_note (type=technical_note, stage=?)` | `electrical/electrical_systems/design (type=technical_note, stage=?)` | LLM_MERGED | engineeringWork: technical_note vs design (DISAGREE) | Electrical Services | Emergency Standby Power Generation<br>IPS/UPS Power Systems<br>LV Power Distribution Systems<br>HV Power Supply System | New Design Schematics - Electrical<br>Developed Design Schematics - Electrical<br>Developed Design Schedule - Electrical<br>Developed Design Drawing - Electrical |
| 46 | **DISAGREE** | Updated Technical Note - MEP | DEVELOPER_APPROVED | Updated Technical Note - MEP | Leighton Hospital | `mechanical/mechanical_systems/technical_note (type=technical_note, stage=?)` | `mechanical/mechanical_systems/design (type=technical_note, stage=?)` | LLM_MERGED | engineeringWork: technical_note vs design (DISAGREE) | Combined MEP Services | Primary Heating & Cooling System | New Design Specification - MEP<br>Developed Design Report - MEP<br>New Design Schematics - MEP<br>Developed Design Drawing - MEP<br>New 3D Model - MEP<br>New Design Schedule - MEP |
| 47 | **DISAGREE** | Updated Technical Note - Public Health | DEVELOPER_APPROVED | Updated Technical Note - Public Health | Leighton Hospital | `public_health/public_health_system/technical_note (type=technical_note, stage=?)` | `public_health/public_health_system/design (type=technical_note, stage=?)` | LLM_MERGED | engineeringWork: technical_note vs design (DISAGREE) | Public Health Services | Cold Water Distribution System | New Design Drawing - Public Health |
| 48 | **AGREE** | VI-019 Desktop Study - Link Bridge Foundations | DEVELOPER_MODIFIED | VI-019 Desktop Study - Link Bridge Foundations | SYN1 Northvale June 2026 Programme | `structural/foundations/analysis (type=assessment, stage=stage_3)` | `structural/foundations/analysis (type=assessment, stage=stage_3)` | LLM_MERGED | — | Link Structure | VI-019 Notification Date<br>Foundation Assessment Study | Detailed Design<br>VI-061 Confirmation of Link Bridge 'Option 2' as preferred design solution<br>VI-052 Link Bridge - Option 1 (Early Stage 3 Structural Analysis)<br>VI-046 Link Bridge Surveys |
| 49 | **REASONING_MORE_COMPLETE** | VI-027 - Inclusion of Paeds Link | REJECTED | VI-027 - Inclusion of Paeds Link | SYN1 Northvale June 2026 Programme | `?/?/?` | `?/link_bridge/analysis (type=report, stage=stage_3)` | LLM_REASONED | engineeringObject: null -> link_bridge (more specific)<br>engineeringWork: null -> analysis (more specific)<br>deliverableType: null -> report (more specific)<br>lifecycleStage: null -> stage_3 (more specific) | Paeds Link Corridor | Notification Date<br>Undertake feasibility study for Peads Link Corridor<br>GET - Notification from WD not to continue | *(none)* |
| 50 | **AGREE** | VI-045 - Generator Compound — Work package | DEVELOPER_MODIFIED | VI-045 - Generator Compound — Work package | SYN1 Northvale June 2026 Programme | `structural/foundations/design (type=milestone, stage=stage_3)` | `structural/foundations/design (type=milestone, stage=stage_3)` | LLM_MERGED | — | VI-045 - Generator Compound | GET - Fixed Compound layout<br>GET - Final equipment weights<br>Stage 3 Structural Design<br>Stage 3 Drainage Design<br>Generator Compound Stage 3 Complete | *(none)* |
| 51 | **AGREE** | VI-046 Link Bridge Surveys | DEVELOPER_MODIFIED | VI-046 Link Bridge Surveys | SYN1 Northvale June 2026 Programme | `structural/link_bridge/inspection (type=survey, stage=stage_3)` | `?/link_bridge/inspection (type=survey, stage=stage_3)` | LLM_REASONED | — | Link Structure | Prepare Survey Specification<br>Supervise Surveys<br>Update GIR<br>GET - Receive final GI results | Detailed Design<br>VI-061 Confirmation of Link Bridge 'Option 2' as preferred design solution<br>VI-019 Desktop Study - Link Bridge Foundations<br>VI-052 Link Bridge - Option 1 (Early Stage 3 Structural Analysis) |
| 52 | **AGREE** | VI-061 Confirmation of Link Bridge 'Option 2' as preferred design solution | DEVELOPER_MODIFIED | VI-061 Confirmation of Link Bridge 'Option 2' as preferred design solution | SYN1 Northvale June 2026 Programme | `structural/link_bridge/design (type=milestone, stage=stage_3)` | `structural/link_bridge/design (type=milestone, stage=stage_3)` | LLM_REASONED | — | Link Structure | GET - Architect layout and floor levels<br>GET - Architect Wall and Roof Buildups<br>GET - Initial fabricator input<br>Superstructure design<br>Foundation design<br>Stage 3 Drawing Issue<br>Project Team Review of Stage 3 Information<br>Stage 4 Structure and Foundations (P Issue)<br>Project Team Review<br>Updates to information following review<br>Link Bridge Structural C01 Issue | Detailed Design<br>VI-019 Desktop Study - Link Bridge Foundations<br>VI-052 Link Bridge - Option 1 (Early Stage 3 Structural Analysis)<br>VI-046 Link Bridge Surveys |

## Per-decision detail

### 1. Additional Engineering Management Works

- **Classification:** DISAGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `d090b4b8cbd5560ae366816d`
- **Deliverable:** Additional Engineering Management Works — SYN1 Northvale June 2026 Programme
- **Decision identity:** `project_management/project_management/coordination (type=?, stage=stage_3)`
- **Reasoned identity:** `?/?/review (type=report, stage=stage_3)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** EW-001 - Review Additional Works
- **Field notes:**
  - engineeringWork: coordination vs review (DISAGREE)
  - deliverableType: null -> report (more specific)
- **Activities fed to reasoning (3):**
  - Produce M&T report and Update specs
  - Produce Hazard Log + Class 3 Risk Assessment
  - Undertake BWIC Co-ordination
- **Neighbours:** Additional Structural Works; Additional Ground Investigation; Additional Drainage Works

### 2. Additional Ground Investigation

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `0a9531202de56c1564fbe456`
- **Deliverable:** Additional Ground Investigation — SYN1 Northvale June 2026 Programme
- **Decision identity:** `ground_investigation/?/inspection (type=report, stage=stage_3)`
- **Reasoned identity:** `?/?/inspection (type=report, stage=stage_3)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** EW-001 - Review Additional Works
- **Activities fed to reasoning (6):**
  - Specify additional Ground Investigation
  - Mobilise Ground Investigation (By others)
  - Fielworks Ground Investigation (By others)
  - Lab Testing Ground Investigation (By others)
  - GET- Confirmation from client to proceed with spec
  - Produce GIR
- **Neighbours:** Additional Structural Works; Additional Engineering Management Works; Additional Drainage Works

### 3. Additional Structural Works

- **Classification:** DISAGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `81f64d7e742d35ce0eb2b175`
- **Deliverable:** Additional Structural Works — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/?/coordination (type=?, stage=stage_3)`
- **Reasoned identity:** `structural/slabs/review (type=report, stage=stage_3)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** EW-001 - Review Additional Works
- **Field notes:**
  - engineeringObject: null -> slabs (more specific)
  - engineeringWork: coordination vs review (DISAGREE)
  - deliverableType: null -> report (more specific)
- **Activities fed to reasoning (16):**
  - Produce Specification for Link Structure Surveys
  - Remove Movement Joint
  - Update transfer slab thickness
  - Update cantilever screen support
  - Coordinate masonry supports
  - Review & update structure to accomodate shower recesses
  - Update Slab Thickenings
  - Canopy Update - Level 07
  - Update entrance area structure
  - WD Request for Link Structure foundation assessment
  - MMD conducts scoping exercise for Link structure foundations
  - Retrack the Ambulance bay
  - GET - Receive Ambulance Bay info from Trust
  - VI - 016 Ambulance Bay Tracking Documentation
  - GET - Receive comments on Cantilever Screen Support from Design Team
  - GET - Masonry support details from specialist
- **Neighbours:** Additional Ground Investigation; Additional Engineering Management Works; Additional Drainage Works

### 4. Ambulance Bay Canopy

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `68e5d44dd19afac5401f4fc0`
- **Deliverable:** Ambulance Bay Canopy — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/steelwork/detailing (type=drawing, stage=stage_3)`
- **Reasoned identity:** `structural/steelwork/detailing (type=drawing, stage=stage_3)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Secondary Steelwork
- **Activities fed to reasoning (4):**
  - Secondary steelwork drawings - Ambulance bay canopy
  - Wilmott Dixon Review Secondary Steelwork Drawings
  - Update & Reissue Secondary Steelwork Drawings
  - GET - Formal Acceptance of Secondary Steelwork Drawings - Ambulance bay canopy
- **Neighbours:** Partitions; Elevations; Ceilings; Detailed Design

### 5. Architectural Setting Out

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `acb87f258c45325d0154e2fb`
- **Deliverable:** Architectural Setting Out — SYN1 Northvale June 2026 Programme
- **Decision identity:** `project_management/project_management/detailing (type=drawing, stage=stage_3)`
- **Reasoned identity:** `?/?/detailing (type=drawing, stage=stage_3)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** GET Milestones
- **Activities fed to reasoning (12):**
  - GET - Architectural Setting out of Upstands & Slab Edges - Level 6
  - GET - Architectural Setting out of Upstands & Slab Edges - Level 7
  - GET - Architectural Setting out of Upstands & Slab Edges - Level 8
  - GET - Architectural Setting out of Upstands & Slab Edges - Level 9
  - GET - Architectural Setting out of Upstands & Slab Edges - Level 10
  - GET - Architectural Setting out of Upstands & Slab Edges - Level 11
  - GET - Architectural Setting out of Upstands & Slab Edges - Level 12
  - GET -Architectural Details for Contractor Proposal drawings
  - GET - Updated architectural Setting out of Upstands & Slab Edges - Level 6
  - GET - Updated architectural Setting out of Upstands & Slab Edges - Level 7
  - GET - Updated architectural Setting out of Upstands & Slab Edges - Level 9
  - GET - Updated architectural Setting out of Upstands & Slab Edges - Level 8
- **Neighbours:** Drainage; Link Structure Survey; GI; Equipment Specifications; BWIC; Enabling Works

### 6. BWIC

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `9383d2207d27e5f25d58420a`
- **Deliverable:** BWIC — SYN1 Northvale June 2026 Programme
- **Decision identity:** `project_management/project_management/coordination (type=milestone, stage=stage_3)`
- **Reasoned identity:** `?/?/coordination (type=milestone, stage=stage_3)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** GET Milestones
- **Activities fed to reasoning (8):**
  - GET Final BWIC Locations & Sizes & Plant Weights - Level 6
  - GET Final BWIC Locations & Sizes & Plant Weights - Level 7
  - GET Final BWIC Locations & Sizes & Plant Weights - Level 8
  - GET Final BWIC Locations & Sizes & Plant Weights - Level 9
  - GET Final BWIC Locations & Sizes & Plant Weights - Level 10
  - GET Final BWIC Locations & Sizes & Plant Weights - Level 11
  - GET Final BWIC Locations & Sizes & Plant Weights - Level 12
  - GET Final BWIC locations through walls
- **Neighbours:** Drainage; Link Structure Survey; GI; Equipment Specifications; Enabling Works; Architectural Setting Out

### 7. CE-015 GL6 Foundation Alteration Feasibility — Work package

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `882f329be77fcb8512af10ef`
- **Deliverable:** CE-015 GL6 Foundation Alteration Feasibility — Work package — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/foundations/design (type=?, stage=stage_3)`
- **Reasoned identity:** `structural/foundations/design (type=?, stage=stage_3)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** CE-015 GL6 Foundation Alteration Feasibility
- **Activities fed to reasoning (5):**
  - Receive survey information for existing GL6 Foundations
  - Additional GI
  - Design options for GL6 Foundations alterations
  - Agree option for GL6 Foundations
  - Final Design and detailing for GL6 Foundations

### 8. Ceilings

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `0477d3196272727d9ca68366`
- **Deliverable:** Ceilings — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/steelwork/detailing (type=drawing, stage=stage_3)`
- **Reasoned identity:** `structural/steelwork/detailing (type=drawing, stage=stage_3)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Secondary Steelwork
- **Activities fed to reasoning (4):**
  - Secondary steelwork drawings - Theatre ceilings
  - Wilmott Dixon Review Secondary Steelwork Drawings
  - Update & Reissue Secondary Steelwork Drawings
  - GET - Formal Acceptance of Secondary Steelwork Drawings - Theatre ceilings
- **Neighbours:** Partitions; Ambulance Bay Canopy; Elevations; Detailed Design

### 9. Contract Award — Work package

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `fb3c464bdeca7365c1f244a6`
- **Deliverable:** Contract Award — Work package — SYN1 Northvale June 2026 Programme
- **Decision identity:** `project_management/project_management/milestone (type=milestone, stage=stage_3)`
- **Reasoned identity:** `project_management/project_management/milestone (type=milestone, stage=stage_3)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Contract Award
- **Activities fed to reasoning (2):**
  - Confirmation of contract award
  - Agreed scope

### 10. Design (Developed Design Report - MEP)

- **Classification:** DISAGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `857f90a4dd76939215e6091c`
- **Deliverable:** New Design Specification - MEP — Leighton Hospital
- **Decision identity:** `mechanical/mechanical_systems/design (type=report, stage=developed_design)`
- **Reasoned identity:** `mechanical/mechanical_systems/design (type=specification, stage=?)` (source=LLM_REASONED, matched rows=3)
- **Fragnet / WBS:** Combined MEP Services
- **Field notes:**
  - deliverableType: report vs specification (DISAGREE)
  - variant (1×, DISAGREE): mechanical/mechanical_systems/design (type=specification, stage=?) — deliverableType: report vs specification (DISAGREE)
  - variant (2×, AGREE): mechanical/mechanical_systems/design (type=report, stage=?)
- **Activities fed to reasoning (1):**
  - NBS MEP Specification
- **Neighbours:** Developed Design Report - MEP; New Design Schematics - MEP; Developed Design Drawing - MEP; Updated Technical Note - MEP; New 3D Model - MEP; New Design Schedule - MEP

### 11. Design Schematics (New Design Schematics - Mechanical)

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `3b9dec080746646e236fa816`
- **Deliverable:** New Design Schematics - MEP — Leighton Hospital
- **Decision identity:** `mechanical/mechanical_systems/design (type=drawing, stage=stage_2)`
- **Reasoned identity:** `?/?/design (type=drawing, stage=?)` (source=LLM_MERGED, matched rows=3)
- **Fragnet / WBS:** Combined MEP Services
- **Field notes:**
  - variant (1×, AGREE): ?/?/design (type=drawing, stage=?)
  - variant (2×, AGREE): mechanical/mechanical_systems/design (type=drawing, stage=?)
- **Activities fed to reasoning (5):**
  - Fire Hydrants Schematic
  - Above Ground Drainage Schematics - Cluster 1-13
  - Above Ground Drainage Schematics - Hub
  - GA Plans Primary Pipework Distribution Schematics - CSSD Building
  - GA Plans Primary Pipework Distribution Schematics - Main Building
- **Neighbours:** New Design Specification - MEP; Developed Design Report - MEP; Developed Design Drawing - MEP; Updated Technical Note - MEP; New 3D Model - MEP; New Design Schedule - MEP

### 12. Detailed Design (core)

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `c9b3ddc49bd67dbbe86f4eac`
- **Deliverable:** Detailed Design — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/core/design (type=?, stage=stage_3)`
- **Reasoned identity:** `structural/core/design (type=?, stage=stage_3)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** Structural Design
- **Activities fed to reasoning (3):**
  - Column design
  - Wall design
  - Update core riser openings
- **Neighbours:** Core General Arrangements; Column Elevations; Wall Elevations; Structural Design — Work package; Reinforcement Detailing; Model/Drawing Development

### 13. Detailed Design (drainage)

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `e5a95632ace21d0e28cfc9c0`
- **Deliverable:** Detailed Design — SYN1 Northvale June 2026 Programme
- **Decision identity:** `civil/drainage/design (type=?, stage=stage_3)`
- **Reasoned identity:** `civil/drainage/design (type=?, stage=stage_3)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** Drainage Design
- **Activities fed to reasoning (1):**
  - Drainage design
- **Neighbours:** Model/Drawing Development

### 14. Detailed Design (foundations)

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `c1e7f0e7965ab4ccf4ea690d`
- **Deliverable:** Detailed Design — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/foundations/design (type=?, stage=stage_3)`
- **Reasoned identity:** `structural/foundations/design (type=?, stage=stage_3)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** Foundations
- **Activities fed to reasoning (5):**
  - Agree vertical loads
  - Calculate wind and notional loads
  - Detailed load-take-down
  - Stability Analysis
  - Foundation analysis and design
- **Neighbours:** Reinforcement Detailing; Model Drawing/Development

### 15. Detailed Design (link bridge)

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `b83c99a779af566139fe9283`
- **Deliverable:** Detailed Design — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/link_bridge/design (type=?, stage=stage_3)`
- **Reasoned identity:** `structural/link_bridge/design (type=?, stage=stage_3)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** Link Structure
- **Activities fed to reasoning (2):**
  - GET - Confirmed Link Structure Design Option
  - Link Structure Options Study
- **Neighbours:** VI-061 Confirmation of Link Bridge 'Option 2' as preferred design solution; VI-019 Desktop Study - Link Bridge Foundations; VI-052 Link Bridge - Option 1 (Early Stage 3 Structural Analysis); VI-046 Link Bridge Surveys

### 16. Detailed Design (slabs, Level 9)

- **Classification:** DISAGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `856cf83af769543fb132fe3e`
- **Deliverable:** Detailed Design — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/slabs/design (type=?, stage=stage_3)`
- **Reasoned identity:** `structural/slabs/analysis (type=analysis, stage=stage_3)` (source=LLM_MERGED, matched rows=6)
- **Fragnet / WBS:** Level 12
- **Field notes:**
  - engineeringWork: design vs analysis (DISAGREE)
  - deliverableType: null -> analysis (more specific)
  - variant (2×, DISAGREE): structural/slabs/analysis (type=analysis, stage=stage_3) — engineeringWork: design vs analysis (DISAGREE); deliverableType: null -> analysis (more specific)
  - variant (2×, REASONING_MORE_COMPLETE): structural/slabs/design (type=milestone, stage=stage_3) — deliverableType: null -> milestone (more specific)
  - variant (1×, AGREE): ?/slabs/design (type=?, stage=stage_3)
  - variant (1×, AGREE): structural/slabs/design (type=?, stage=stage_3)
- **Activities fed to reasoning (1):**
  - Slab analysis - Level 12
- **Neighbours:** Model/Drawing Development; Reinforcement Detailing

### 17. Detailed Design (steelwork)

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `235f3c06c6db1cb5cf14f82b`
- **Deliverable:** Detailed Design — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/steelwork/design (type=drawing, stage=stage_3)`
- **Reasoned identity:** `structural/steelwork/design (type=drawing, stage=stage_3)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** Secondary Steelwork
- **Activities fed to reasoning (10):**
  - Secondary steelwork design - theatre ceilings
  - Secondary steelwork design - partitions
  - Secondary steelwork design - elevations
  - Secondary steelwork design - Ambulance bay canopy
  - GET - Architectural Partition Layout
  - GET - RPA and BWIC info to release theatre steelwork design
  - GET - Peads link corridor canopy interface strategy confirmation
  - Update Secondary steelwork design - partitions
  - Update Secondary steelwork design - elevations (blast louvres)
  - Theatre ceiling coordination
- **Neighbours:** Partitions; Ambulance Bay Canopy; Elevations; Ceilings

### 18. Detailed Design (walls/slabs, Level 7)

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `8a7da4fb09dff42f803f4efd`
- **Deliverable:** Detailed Design — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/slabs/design (type=?, stage=stage_3)`
- **Reasoned identity:** `?/slabs/design (type=?, stage=stage_3)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** Level 7
- **Activities fed to reasoning (2):**
  - Slab analysis - Level 07
  - GET - Curtain wall deflection tolerance update
- **Neighbours:** Model/Drawing Development; Reinforcement Detailing

### 19. Developed Design Drawing - Electrical

- **Classification:** AGREE
- **Status:** DEVELOPER_APPROVED
- **Fingerprint:** `feab497581f055968f1d8c81`
- **Deliverable:** Developed Design Drawing - Electrical — Leighton Hospital
- **Decision identity:** `electrical/electrical_systems/design (type=design_drawing, stage=?)`
- **Reasoned identity:** `electrical/electrical_systems/design (type=design_drawing, stage=?)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Electrical Services
- **Activities fed to reasoning (26):**
  - Sitewide HV Ring Networks (1:1000)
  - Generator House & HV Intake Layout & Schematic (1:100)
  - Generator Room Arrangement (1:50)
  - Main Switchroom & UPS Room Layout (1:30)
  - Switchroom & Riser Layouts (1:40)
  - Main Building Security Zoning
  - Containment Strategy - Level 00 - Sheets 1-4 (1:100)
  - Containment Strategy - Level 01 - Sheets 1-4 (1:100)
  - Containment Strategy - Level 02 - Sheets 1-4 (1:100)
  - Containment Strategy - Level 05 - Sheet 2 & 3 (1:100)
  - LV Distribution Site Layout (1:1000)
  - Distribution Zoning Strategy Layout - Level 00 - Sheets 1-4 (1:100)
  - Distribution Zoning Strategy Layout - Level 01 - Sheets 1-4 (1:100)
  - Distribution Zoning Strategy Layout - Level 02 - Sheets 1-4 (1:100)
  - Distribution Zoning Strategy Layout - Level 03 - Sheets 1-4 (1:100)
  - Distribution Zoning Strategy Layout - Level 04 - Sheets 1-4 (1:100)
  - Distribution Zoning Strategy Layout - Level 05 - Sheets 1-4 (1:100)
  - Main Switch Gear & Distribution Routes Dwgs 4 Sheets
  - Lighting Strategy Layout Sheets 1 & 2 (1:100)
  - Lighting Strategy Layout Sheet 1 of 1 (1:100) 2
  - Lighting Strategy Layout Sheet 1 of 1 (1:100) 3
  - Lighting Strategy Layout Sheet 1 of 1 (1:100) 4
  - Lighting Strategy Layout Sheet 1 of 1 (1:100) 5
  - Lighting Strategy Layout Sheet 1 of 1 (1:100) 6
  - Lightning Protection Dwg 2 Sheets (1:400)
  - Sitewide External Lighting Philosophy (1:1000)
- **Neighbours:** New Design Schematics - Electrical; Updated Technical Note - Electrical; Developed Design Schematics - Electrical; Developed Design Schedule - Electrical

### 20. Developed Design Drawing - MEP

- **Classification:** AGREE
- **Status:** DEVELOPER_APPROVED
- **Fingerprint:** `fd8af2d793e91a88055d1861`
- **Deliverable:** Developed Design Drawing - MEP — Leighton Hospital
- **Decision identity:** `mechanical/plant_room/design (type=design_drawing, stage=?)`
- **Reasoned identity:** `mechanical/plant_room/design (type=design_drawing, stage=?)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Combined MEP Services
- **Activities fed to reasoning (20):**
  - External Services Layout (1:1000)
  - CSSD Plantroom (1:100)
  - Cluster 01-A & 01-B Plantrooms (1:100)
  - Cluster 02-A & 03-A Plantrooms (1:100)
  - Cluster 04-A & 04-B Plantrooms (1:100)
  - Cluster 05-A & 05-B Plantrooms (1:100)
  - Cluster 06-A & 06-B Plantrooms (1:100)
  - Cluster 07-A Plantrooms (1:100)
  - Cluster 09-A & 09-B Plantrooms (1:100)
  - Cluster 11-A & 11-B Plantrooms (1:100)
  - Cluster 12-A & 12-B Plantrooms (1:100)
  - Cluster 13-A & 13-B Plantrooms (1:100)
  - Cluster 06-A & 09-A Plantrooms (1:100)
  - Cluster 01-A & 04-A Plantrooms (1:100)
  - Cluster 11-A & 13-A Plantrooms (1:100)
  - Energy Centre-A & B Plantrooms (1:100)
  - Generator House-A & B Plantrooms (1:100)
  - Med Gas Manifold Plantrooms (1:100)
  - Shallow Geothermal Closed Loop Borehole Array 1:1000
  - Energy Strategy Report
- **Neighbours:** New Design Specification - MEP; Developed Design Report - MEP; New Design Schematics - MEP; Updated Technical Note - MEP; New 3D Model - MEP; New Design Schedule - MEP

### 21. Developed Design Schedule - Electrical

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `f302ac06fbad7ef5efa44e4e`
- **Deliverable:** Developed Design Schedule - Electrical — Leighton Hospital
- **Decision identity:** `electrical/electrical_systems/design (type=schedule, stage=?)`
- **Reasoned identity:** `electrical/electrical_systems/design (type=schedule, stage=?)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Electrical Services
- **Activities fed to reasoning (1):**
  - Internal Lighting Luminaire Schedule
- **Neighbours:** New Design Schematics - Electrical; Updated Technical Note - Electrical; Developed Design Schematics - Electrical; Developed Design Drawing - Electrical

### 22. Developed Design Schedule - Mechanical

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `0617df81bd876994e7fb9f68`
- **Deliverable:** Developed Design Schedule - Mechanical — Leighton Hospital
- **Decision identity:** `mechanical/mechanical_systems/design (type=schedule, stage=?)`
- **Reasoned identity:** `mechanical/mechanical_systems/design (type=schedule, stage=?)` (source=LLM_REASONED, matched rows=2)
- **Fragnet / WBS:** Mechanical Services
- **Activities fed to reasoning (2):**
  - AHU Resiliency Strategy
  - Medical Gas Requirements Room Matrix
- **Neighbours:** New Design Schematics - Mechanical; Developed Design Report - Mechanical; Developed Design Schematics - Mechanical; Updated Technical Note - Mechanical

### 23. Developed Design Schematics - Electrical

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `465215bbe047cea8fc55793a`
- **Deliverable:** New Design Schematics - Electrical — Leighton Hospital
- **Decision identity:** `electrical/electrical_systems/design (type=drawing, stage=?)`
- **Reasoned identity:** `electrical/electrical_systems/design (type=drawing, stage=?)` (source=LLM_REASONED, matched rows=2)
- **Fragnet / WBS:** Electrical Services
- **Activities fed to reasoning (7):**
  - Fire Alarm Schematic - CSSD Building
  - CSSD Building Security System Schematic
  - Containment Strategy - Sheet 1 (1:100)
  - Distribution Zoning Strategy Layout
  - Main Switch Gear & Distribution Routes Dwgs
  - Lighting Strategy Layout Sheet 1 of 1 (1:100)
  - Lightning Protection Dwg (1:400)
- **Neighbours:** Updated Technical Note - Electrical; Developed Design Schematics - Electrical; Developed Design Schedule - Electrical; Developed Design Drawing - Electrical

### 24. Drainage

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `7de6ec24280cb5f1687bdd19`
- **Deliverable:** Drainage — SYN1 Northvale June 2026 Programme
- **Decision identity:** `public_health/drainage/coordination (type=milestone, stage=stage_3)`
- **Reasoned identity:** `public_health/drainage/coordination (type=milestone, stage=stage_3)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** GET Milestones
- **Activities fed to reasoning (1):**
  - GET Receive drainage pop-up locations & flow rates from SDS
- **Neighbours:** Link Structure Survey; GI; Equipment Specifications; BWIC; Enabling Works; Architectural Setting Out

### 25. Due Diligence — Work package

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `6747be119fae4bcd66c16c3c`
- **Deliverable:** Due Diligence — Work package — SYN1 Northvale June 2026 Programme
- **Decision identity:** `project_management/project_management/review (type=report, stage=stage_3)`
- **Reasoned identity:** `project_management/project_management/review (type=report, stage=stage_3)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Due Diligence
- **Activities fed to reasoning (9):**
  - Stability Analysis Review
  - Slab Analysis review
  - Load-take down / Colum / Foundation review
  - Model review
  - Geotechnical information review
  - Civil engineering information review
  - Due-diligence report submission
  - Review DD works with WD / UHP
  - Undertake Onboarding

### 26. Enabling Works

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `7063c055ede768e6f3fcaf78`
- **Deliverable:** Enabling Works — SYN1 Northvale June 2026 Programme
- **Decision identity:** `project_management/project_management/milestone (type=milestone, stage=stage_3)`
- **Reasoned identity:** `project_management/project_management/milestone (type=milestone, stage=stage_3)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** GET Milestones
- **Activities fed to reasoning (1):**
  - GET Enabling Works Information
- **Neighbours:** Drainage; Link Structure Survey; GI; Equipment Specifications; BWIC; Architectural Setting Out

### 27. Equipment Specifications

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `e6f0a65f33a0d70d2033a367`
- **Deliverable:** Equipment Specifications — SYN1 Northvale June 2026 Programme
- **Decision identity:** `project_management/project_management/design (type=specification, stage=stage_3)`
- **Reasoned identity:** `?/?/design (type=specification, stage=stage_3)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** GET Milestones
- **Activities fed to reasoning (1):**
  - GET Imaging Equipment Specifications
- **Neighbours:** Drainage; Link Structure Survey; GI; BWIC; Enabling Works; Architectural Setting Out

### 28. External Finishes Works — Work package

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `fe2aff9901ff42baa4186ee1`
- **Deliverable:** External Finishes Works — Work package — SYN1 Northvale June 2026 Programme
- **Decision identity:** `?/?/detailing (type=design_drawing, stage=stage_3)`
- **Reasoned identity:** `?/?/detailing (type=design_drawing, stage=stage_3)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** External Finishes Works
- **Activities fed to reasoning (5):**
  - Produce draft plan drawings
  - Coordinate with architecture team
  - Produce detailed drawings with typical details
  - Issue to Wilmott Dixon
  - GET - External works drawings from  Architect

### 29. GI

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `d470a2c24dd0df37c208dfee`
- **Deliverable:** GI — SYN1 Northvale June 2026 Programme
- **Decision identity:** `project_management/project_management/milestone (type=milestone, stage=stage_3)`
- **Reasoned identity:** `project_management/project_management/milestone (type=milestone, stage=stage_3)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** GET Milestones
- **Activities fed to reasoning (1):**
  - GET Additional GI
- **Neighbours:** Drainage; Link Structure Survey; Equipment Specifications; BWIC; Enabling Works; Architectural Setting Out

### 30. MMD/Client Programme Alignment - Prolongation

- **Classification:** DISAGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `61ccdbcea9a2cc2eb8abae25`
- **Deliverable:** MMD/Client Programme Alignment - Prolongation — SYN1 Northvale June 2026 Programme
- **Decision identity:** `project_management/project_management/coordination (type=programme, stage=stage_3)`
- **Reasoned identity:** `project_management/project_management/review (type=programme, stage=stage_3)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Change
- **Field notes:**
  - engineeringWork: coordination vs review (DISAGREE)
- **Activities fed to reasoning (1):**
  - Programme Prolongation

### 31. Model Development (Level 7)

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `2fd3011377f2800028e5686a`
- **Deliverable:** Model/Drawing Development — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/?/general_arrangement (type=drawing, stage=stage_3)`
- **Reasoned identity:** `?/?/general_arrangement (type=drawing, stage=stage_3)` (source=LLM_MERGED, matched rows=7)
- **Fragnet / WBS:** Level 7
- **Activities fed to reasoning (4):**
  - General Arrangement - Level 07
  - Wilmott Dixon Review Level 07 General Arrangement Drawings
  - Update & Reissue General Arrangement Drawings
  - GET - Formal Acceptance of Level 07 General Arrangement Drawings
- **Neighbours:** Reinforcement Detailing; Detailed Design

### 32. Model Drawing/Development (foundations)

- **Classification:** AGREE
- **Status:** DEVELOPER_APPROVED
- **Fingerprint:** `f737e3f2a41043359f208f33`
- **Deliverable:** Model Drawing/Development — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/foundations/general_arrangement (type=general_arrangement, stage=stage_3)`
- **Reasoned identity:** `structural/foundations/general_arrangement (type=general_arrangement, stage=stage_3)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** Foundations
- **Activities fed to reasoning (4):**
  - Foundation General Arrangement Drawings
  - Wilmott Dixon Review Foundation General Arrangement Drawings
  - Update & Reissue General Arrangement Drawings
  - GET - Formal Acceptance of Foundation General Arrangement Drawings
- **Neighbours:** Detailed Design; Reinforcement Detailing

### 33. Model/Drawing Development (drainage)

- **Classification:** AGREE
- **Status:** DEVELOPER_APPROVED
- **Fingerprint:** `68b748c1cfebb97d5022770a`
- **Deliverable:** Model/Drawing Development — SYN1 Northvale June 2026 Programme
- **Decision identity:** `public_health/drainage/design (type=design_drawing, stage=stage_3)`
- **Reasoned identity:** `public_health/drainage/design (type=design_drawing, stage=stage_3)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** Drainage Design
- **Activities fed to reasoning (1):**
  - Develop drainage design drawings and issue
- **Neighbours:** Detailed Design

### 34. Model/Drawing Development (Structural Design)

- **Classification:** AGREE
- **Status:** DEVELOPER_APPROVED
- **Fingerprint:** `3b909ddd94c25442207aaef9`
- **Deliverable:** Model/Drawing Development — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/?/design (type=drawing, stage=stage_3)`
- **Reasoned identity:** `structural/?/design (type=drawing, stage=stage_3)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** Structural Design
- **Activities fed to reasoning (2):**
  - Front end-guidance strategy drawings
  - Loading Plans etc
- **Neighbours:** Core General Arrangements; Column Elevations; Wall Elevations; Structural Design — Work package; Reinforcement Detailing; Detailed Design

### 35. New Design Drawing - Public Health

- **Classification:** AGREE
- **Status:** DEVELOPER_APPROVED
- **Fingerprint:** `1e7c87ba49c0456464600cc4`
- **Deliverable:** New Design Drawing - Public Health — Leighton Hospital
- **Decision identity:** `public_health/drainage/detailing (type=design_drawing, stage=?)`
- **Reasoned identity:** `public_health/drainage/detailing (type=design_drawing, stage=?)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** Public Health Services
- **Activities fed to reasoning (1):**
  - Details Standard Drainage (One sheet)
- **Neighbours:** Updated Technical Note - Public Health

### 36. New Design Report - Acoustics

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `cc420407aa7a463bc1a36fd2`
- **Deliverable:** New Design Report - Acoustics — Leighton Hospital
- **Decision identity:** `acoustics/acoustics/design (type=report, stage=?)`
- **Reasoned identity:** `acoustics/acoustics/design (type=report, stage=?)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Acoustics
- **Activities fed to reasoning (1):**
  - RIBA Stage Acoustic Strategy Report
- **Neighbours:** New Technical Note - Acoustics

### 37. New Design Report - Fire Safety Engineering

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `abcf2aa813a672a38f1e61ea`
- **Deliverable:** New Design Report - Fire Safety Engineering — Leighton Hospital
- **Decision identity:** `fire_engineering/fire_safety/design (type=report, stage=?)`
- **Reasoned identity:** `fire_engineering/fire_safety/design (type=report, stage=?)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Fire Safety Engineering
- **Activities fed to reasoning (1):**
  - RIBA Stage Fire Strategy Report
- **Neighbours:** New Technical Note - Fire Safety Engineering

### 38. New Technical Note - Acoustics

- **Classification:** AGREE
- **Status:** DEVELOPER_APPROVED
- **Fingerprint:** `1c2a3b04c7759fe16debe4ec`
- **Deliverable:** New Technical Note - Acoustics — Leighton Hospital
- **Decision identity:** `acoustics/acoustics/analysis (type=technical_note, stage=?)`
- **Reasoned identity:** `acoustics/acoustics/analysis (type=technical_note, stage=?)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** Acoustics
- **Activities fed to reasoning (1):**
  - Atrium acoustic absorption for reverberation - calcs in a model
- **Neighbours:** New Design Report - Acoustics

### 39. Partitions

- **Classification:** DISAGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `24d765837f2986144a2f7b57`
- **Deliverable:** Partitions — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/steelwork/detailing (type=drawing, stage=stage_3)`
- **Reasoned identity:** `structural/steelwork/detailing (type=design_drawing, stage=stage_3)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Secondary Steelwork
- **Field notes:**
  - deliverableType: drawing vs design_drawing (DISAGREE)
- **Activities fed to reasoning (5):**
  - Secondary steelwork drawings - partitions
  - Wilmott Dixon Review Secondary Steelwork Drawings
  - Update & Reissue Secondary Steelwork Drawings
  - GET - Formal Acceptance of Secondary Steelwork Drawings - partitions
  - GET - Confirmation of pressure stabiliser vent positions
- **Neighbours:** Ambulance Bay Canopy; Elevations; Ceilings; Detailed Design

### 40. Report - Sustainability - BREEAM

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `ae9733559b2368653a8b1959`
- **Deliverable:** Report - Sustainability - BREEAM — Leighton Hospital
- **Decision identity:** `sustainability/?/calculation (type=report, stage=?)`
- **Reasoned identity:** `?/?/? (type=report, stage=?)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Sustainability
- **Activities fed to reasoning (3):**
  - BREEAM Stage 3 Summary Report
  - Mat 06 RIBA 2 Material Efficiency Report
  - MAT 05 Design for Durability & Resiliance
- **Neighbours:** Report - Sustainability - Net Zero Carbon; Report - Sustainability - Environment / Sustainability

### 41. Report - Sustainability - Environment / Sustainability

- **Classification:** DISAGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `7238adfc778945a24dbe834e`
- **Deliverable:** Report - Sustainability - Environment / Sustainability — Leighton Hospital
- **Decision identity:** `sustainability/?/modelling (type=report, stage=?)`
- **Reasoned identity:** `sustainability/?/analysis (type=report, stage=?)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Sustainability
- **Field notes:**
  - engineeringWork: modelling vs analysis (DISAGREE)
- **Activities fed to reasoning (3):**
  - Operational Energy Modelling Report (TM-54)
  - Thermal Comfort
  - Indoor Air quality Plan
- **Neighbours:** Report - Sustainability - Net Zero Carbon; Report - Sustainability - BREEAM

### 42. Report - Sustainability - Net Zero Carbon

- **Classification:** DISAGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `dddc267c78fd829af0e11bc9`
- **Deliverable:** Report - Sustainability - Net Zero Carbon — Leighton Hospital
- **Decision identity:** `sustainability/?/calculation (type=report, stage=?)`
- **Reasoned identity:** `?/?/analysis (type=report, stage=?)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Sustainability
- **Field notes:**
  - engineeringWork: calculation vs analysis (DISAGREE)
- **Activities fed to reasoning (4):**
  - Net Zero Carbon summary report
  - NHS NZC WLC Toolkit 1&2
  - NHS NZC OEC Toolkit 1&2
  - NHS NZC Design Management Tool 1&2
- **Neighbours:** Report - Sustainability - Environment / Sustainability; Report - Sustainability - BREEAM

### 43. Retired Activities — Work package

- **Classification:** DISAGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `e67251f62aa3e4f0095ee7a0`
- **Deliverable:** Retired Activities — Work package — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/link_bridge/detailing (type=drawing, stage=stage_3)`
- **Reasoned identity:** `structural/link_bridge/design (type=general_arrangement, stage=stage_3)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Retired Activities
- **Field notes:**
  - engineeringWork: detailing vs design (DISAGREE)
  - deliverableType: drawing vs general_arrangement (DISAGREE)
- **Activities fed to reasoning (12):**
  - Masonry / lintel detailing
  - Development of model and sheets
  - Detailed connection intent for precast wall panels
  - Assess existing structure for support of new link structure
  - Design & analysis of new link structure steelwork
  - Produce Link Structure General Arrangement Drawings
  - Wilmott Dixon Review Link Structure General Arrangement Drawings
  - Update & Reissue Link Structure Drawings
  - GET - Formal Acceptance of Link Structure General Arrangement Drawings
  - Produce Reinforcement Detailing for Composite Slabs
  - Link Structure Reinforcement Drawings Released
  - Liaise with LLFA regarding increase in discharge rate

### 44. Structural Design — Work package

- **Classification:** AGREE
- **Status:** DEVELOPER_APPROVED
- **Fingerprint:** `55d197741fabb6d2b2fe877e`
- **Deliverable:** Structural Design — Work package — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/?/design (type=?, stage=stage_3)`
- **Reasoned identity:** `structural/?/design (type=?, stage=stage_3)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Structural Design
- **Activities fed to reasoning (1):**
  - CP Drawings Issue
- **Neighbours:** Core General Arrangements; Column Elevations; Wall Elevations; Reinforcement Detailing; Detailed Design; Model/Drawing Development

### 45. Updated Technical Note - Electrical

- **Classification:** DISAGREE
- **Status:** DEVELOPER_APPROVED
- **Fingerprint:** `117790547f65a36cecb801ad`
- **Deliverable:** Updated Technical Note - Electrical — Leighton Hospital
- **Decision identity:** `electrical/electrical_systems/technical_note (type=technical_note, stage=?)`
- **Reasoned identity:** `electrical/electrical_systems/design (type=technical_note, stage=?)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** Electrical Services
- **Field notes:**
  - engineeringWork: technical_note vs design (DISAGREE)
- **Activities fed to reasoning (4):**
  - Emergency Standby Power Generation
  - IPS/UPS Power Systems
  - LV Power Distribution Systems
  - HV Power Supply System
- **Neighbours:** New Design Schematics - Electrical; Developed Design Schematics - Electrical; Developed Design Schedule - Electrical; Developed Design Drawing - Electrical

### 46. Updated Technical Note - MEP

- **Classification:** DISAGREE
- **Status:** DEVELOPER_APPROVED
- **Fingerprint:** `5853a25cee0af52e5d2d760c`
- **Deliverable:** Updated Technical Note - MEP — Leighton Hospital
- **Decision identity:** `mechanical/mechanical_systems/technical_note (type=technical_note, stage=?)`
- **Reasoned identity:** `mechanical/mechanical_systems/design (type=technical_note, stage=?)` (source=LLM_MERGED, matched rows=2)
- **Fragnet / WBS:** Combined MEP Services
- **Field notes:**
  - engineeringWork: technical_note vs design (DISAGREE)
- **Activities fed to reasoning (1):**
  - Primary Heating & Cooling System
- **Neighbours:** New Design Specification - MEP; Developed Design Report - MEP; New Design Schematics - MEP; Developed Design Drawing - MEP; New 3D Model - MEP; New Design Schedule - MEP

### 47. Updated Technical Note - Public Health

- **Classification:** DISAGREE
- **Status:** DEVELOPER_APPROVED
- **Fingerprint:** `ce908560e4802ab3ec73c905`
- **Deliverable:** Updated Technical Note - Public Health — Leighton Hospital
- **Decision identity:** `public_health/public_health_system/technical_note (type=technical_note, stage=?)`
- **Reasoned identity:** `public_health/public_health_system/design (type=technical_note, stage=?)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** Public Health Services
- **Field notes:**
  - engineeringWork: technical_note vs design (DISAGREE)
- **Activities fed to reasoning (1):**
  - Cold Water Distribution System
- **Neighbours:** New Design Drawing - Public Health

### 48. VI-019 Desktop Study - Link Bridge Foundations

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `2237f8d85f009579e0b22a92`
- **Deliverable:** VI-019 Desktop Study - Link Bridge Foundations — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/foundations/analysis (type=assessment, stage=stage_3)`
- **Reasoned identity:** `structural/foundations/analysis (type=assessment, stage=stage_3)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** Link Structure
- **Activities fed to reasoning (2):**
  - VI-019 Notification Date
  - Foundation Assessment Study
- **Neighbours:** Detailed Design; VI-061 Confirmation of Link Bridge 'Option 2' as preferred design solution; VI-052 Link Bridge - Option 1 (Early Stage 3 Structural Analysis); VI-046 Link Bridge Surveys

### 49. VI-027 - Inclusion of Paeds Link

- **Classification:** REASONING_MORE_COMPLETE
- **Status:** REJECTED
- **Fingerprint:** `7d8a17f1f0894951e60c96f5`
- **Deliverable:** VI-027 - Inclusion of Paeds Link — SYN1 Northvale June 2026 Programme
- **Decision identity:** `?/?/?`
- **Reasoned identity:** `?/link_bridge/analysis (type=report, stage=stage_3)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Paeds Link Corridor
- **Field notes:**
  - engineeringObject: null -> link_bridge (more specific)
  - engineeringWork: null -> analysis (more specific)
  - deliverableType: null -> report (more specific)
  - lifecycleStage: null -> stage_3 (more specific)
- **Activities fed to reasoning (3):**
  - Notification Date
  - Undertake feasibility study for Peads Link Corridor
  - GET - Notification from WD not to continue

### 50. VI-045 - Generator Compound — Work package

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `a8503648a904e1908faba250`
- **Deliverable:** VI-045 - Generator Compound — Work package — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/foundations/design (type=milestone, stage=stage_3)`
- **Reasoned identity:** `structural/foundations/design (type=milestone, stage=stage_3)` (source=LLM_MERGED, matched rows=1)
- **Fragnet / WBS:** VI-045 - Generator Compound
- **Activities fed to reasoning (5):**
  - GET - Fixed Compound layout
  - GET - Final equipment weights
  - Stage 3 Structural Design
  - Stage 3 Drainage Design
  - Generator Compound Stage 3 Complete

### 51. VI-046 Link Bridge Surveys

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `3562f0042bac267d9d2df7c0`
- **Deliverable:** VI-046 Link Bridge Surveys — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/link_bridge/inspection (type=survey, stage=stage_3)`
- **Reasoned identity:** `?/link_bridge/inspection (type=survey, stage=stage_3)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Link Structure
- **Activities fed to reasoning (4):**
  - Prepare Survey Specification
  - Supervise Surveys
  - Update GIR
  - GET - Receive final GI results
- **Neighbours:** Detailed Design; VI-061 Confirmation of Link Bridge 'Option 2' as preferred design solution; VI-019 Desktop Study - Link Bridge Foundations; VI-052 Link Bridge - Option 1 (Early Stage 3 Structural Analysis)

### 52. VI-061 Confirmation of Link Bridge 'Option 2' as preferred design solution

- **Classification:** AGREE
- **Status:** DEVELOPER_MODIFIED
- **Fingerprint:** `5a1f1c828cc8a8c88a890b4a`
- **Deliverable:** VI-061 Confirmation of Link Bridge 'Option 2' as preferred design solution — SYN1 Northvale June 2026 Programme
- **Decision identity:** `structural/link_bridge/design (type=milestone, stage=stage_3)`
- **Reasoned identity:** `structural/link_bridge/design (type=milestone, stage=stage_3)` (source=LLM_REASONED, matched rows=1)
- **Fragnet / WBS:** Link Structure
- **Activities fed to reasoning (11):**
  - GET - Architect layout and floor levels
  - GET - Architect Wall and Roof Buildups
  - GET - Initial fabricator input
  - Superstructure design
  - Foundation design
  - Stage 3 Drawing Issue
  - Project Team Review of Stage 3 Information
  - Stage 4 Structure and Foundations (P Issue)
  - Project Team Review
  - Updates to information following review
  - Link Bridge Structural C01 Issue
- **Neighbours:** Detailed Design; VI-019 Desktop Study - Link Bridge Foundations; VI-052 Link Bridge - Option 1 (Early Stage 3 Structural Analysis); VI-046 Link Bridge Surveys

---

Regenerate with: `npx tsx scripts/report-brain-vs-reasoning.ts`
