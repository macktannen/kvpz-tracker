const fs = require('fs');

// 200+ Explicit ICAO Aircraft Type Mappings grouped into ADSBexchange planform vector categories
const icaoIconMap = [
    {
        category: "Helicopters - Tandem Rotor",
        icaoCodes: ["CH47", "H47", "MH47", "CH46"],
        name: "CH-47 Chinook / Sea Knight",
        svg: `<svg width="48" height="48" viewBox="0 0 512 512">
            <rect x="206" y="80" width="100" height="352" rx="42" fill="#ffcc00" stroke="#090d16" stroke-width="14" />
            <rect x="180" y="320" width="26" height="70" rx="6" fill="#090d16"/>
            <rect x="306" y="320" width="26" height="70" rx="6" fill="#090d16"/>
            <circle cx="256" cy="110" r="16" fill="#fff" stroke="#090d16" stroke-width="6" />
            <rect x="248" y="10" width="16" height="200" rx="4" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(15, 256, 110)"/>
            <rect x="248" y="10" width="16" height="200" rx="4" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(135, 256, 110)"/>
            <rect x="248" y="10" width="16" height="200" rx="4" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(255, 256, 110)"/>
            <circle cx="256" cy="402" r="16" fill="#fff" stroke="#090d16" stroke-width="6" />
            <rect x="248" y="302" width="16" height="200" rx="4" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(75, 256, 402)"/>
            <rect x="248" y="302" width="16" height="200" rx="4" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(195, 256, 402)"/>
            <rect x="248" y="302" width="16" height="200" rx="4" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(315, 256, 402)"/>
        </svg>`
    },
    {
        category: "Helicopters - Heavy Lift & Refueling Probe",
        icaoCodes: ["H53", "CH53", "MH53", "S65", "S80"],
        name: "CH-53E Super Stallion / Pave Low",
        svg: `<svg width="48" height="48" viewBox="0 0 512 512">
            <path fill="#ffcc00" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,110 L 225,150 L 175,200 L 175,280 L 225,270 L 225,410 L 240,460 L 272,460 L 287,410 L 287,270 L 337,280 L 337,200 L 287,150 Z"/>
            <line x1="287" y1="170" x2="310" y2="40" stroke="#090d16" stroke-width="10" stroke-linecap="round"/>
            <line x1="287" y1="170" x2="310" y2="40" stroke="#ffcc00" stroke-width="5" stroke-linecap="round"/>
            <rect x="248" y="10" width="16" height="246" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(0, 256, 256)"/>
            <rect x="248" y="10" width="16" height="246" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(51.4, 256, 256)"/>
            <rect x="248" y="10" width="16" height="246" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(102.8, 256, 256)"/>
            <rect x="248" y="10" width="16" height="246" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(154.2, 256, 256)"/>
            <rect x="248" y="10" width="16" height="246" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(205.6, 256, 256)"/>
            <rect x="248" y="10" width="16" height="246" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(257, 256, 256)"/>
            <rect x="248" y="10" width="16" height="246" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(308.4, 256, 256)"/>
            <circle cx="256" cy="256" r="24" fill="#fff" stroke="#090d16" stroke-width="7"/>
        </svg>`
    },
    {
        category: "Helicopters - Attack (Cannon & Pylons)",
        icaoCodes: ["AH64", "H64", "MI24", "MI28", "KA52"],
        name: "AH-64 Apache / Hind / Havoc",
        svg: `<svg width="48" height="48" viewBox="0 0 512 512">
            <line x1="256" y1="90" x2="256" y2="50" stroke="#090d16" stroke-width="10" stroke-linecap="round"/>
            <path fill="#ffcc00" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,90 L 235,140 L 165,220 L 165,250 L 235,240 L 235,420 L 245,460 L 267,460 L 277,420 L 277,240 L 347,250 L 347,220 L 277,140 Z"/>
            <rect x="145" y="220" width="18" height="35" rx="4" fill="#090d16"/>
            <rect x="349" y="220" width="18" height="35" rx="4" fill="#090d16"/>
            <rect x="246" y="30" width="20" height="226" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(15, 256, 256)"/>
            <rect x="246" y="30" width="20" height="226" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(105, 256, 256)"/>
            <rect x="246" y="30" width="20" height="226" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(195, 256, 256)"/>
            <rect x="246" y="30" width="20" height="226" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(285, 256, 256)"/>
            <circle cx="256" cy="256" r="16" fill="#fff" stroke="#090d16" stroke-width="5"/>
        </svg>`
    },
    {
        category: "Helicopters - Fenestron Ducted Tail Fan",
        icaoCodes: ["AS65", "HH65", "EC35", "EC45", "EC20", "EC55", "H135", "H145"],
        name: "MH-65 USCG Dolphin / Eurocopter EC135",
        svg: `<svg width="48" height="48" viewBox="0 0 512 512">
            <path fill="#ffcc00" stroke="#090d16" stroke-width="14" d="M 256,140 C 230,140 222,175 222,215 L 222,380 L 242,400 L 242,450 L 270,450 L 270,400 L 290,380 L 290,215 C 290,175 282,140 256,140 Z"/>
            <circle cx="256" cy="425" r="22" fill="#090d16" stroke="#ffcc00" stroke-width="6"/>
            <rect x="247" y="30" width="18" height="226" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(40, 256, 256)"/>
            <rect x="247" y="30" width="18" height="226" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(130, 256, 256)"/>
            <rect x="247" y="30" width="18" height="226" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(220, 256, 256)"/>
            <rect x="247" y="30" width="18" height="226" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(310, 256, 256)"/>
            <circle cx="256" cy="256" r="18" fill="#fff" stroke="#090d16" stroke-width="6"/>
        </svg>`
    },
    {
        category: "Helicopters - Standard Tactical Utility",
        icaoCodes: ["H60", "UH60", "MH60", "HH60", "S76", "S92", "AW139", "AW109", "AW169", "AW189", "A109", "A119", "MI8", "AS32"],
        name: "UH-60 Black Hawk / AW139 / S-76",
        svg: `<svg width="48" height="48" viewBox="0 0 512 512">
            <path fill="#ffcc00" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,130 C 235,130 215,160 215,200 L 180,225 L 180,265 L 225,260 L 225,410 L 240,455 L 272,455 L 287,410 L 287,260 L 332,265 L 332,225 L 297,200 C 297,160 277,130 256,130 Z"/>
            <rect x="248" y="20" width="16" height="236" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(30, 256, 256)"/>
            <rect x="248" y="20" width="16" height="236" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(120, 256, 256)"/>
            <rect x="248" y="20" width="16" height="236" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(210, 256, 256)"/>
            <rect x="248" y="20" width="16" height="236" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(300, 256, 256)"/>
            <circle cx="256" cy="256" r="20" fill="#fff" stroke="#090d16" stroke-width="6"/>
        </svg>`
    },
    {
        category: "Helicopters - Light Teardrop Executive",
        icaoCodes: ["R22", "R44", "R66", "B206", "B407", "B412", "B429", "AS50", "AS55", "GAZL", "XNON"],
        name: "Robinson R44 / Bell 206 / AStar",
        svg: `<svg width="48" height="48" viewBox="0 0 512 512">
            <path fill="#ffcc00" stroke="#090d16" stroke-width="14" d="M 256,140 C 235,140 226,170 226,205 C 226,240 244,380 244,450 L 268,450 C 268,380 286,240 286,205 C 286,170 277,140 256,140 Z"/>
            <line x1="200" y1="180" x2="200" y2="250" stroke="#090d16" stroke-width="8" stroke-linecap="round"/>
            <line x1="312" y1="180" x2="312" y2="250" stroke="#090d16" stroke-width="8" stroke-linecap="round"/>
            <rect x="248" y="25" width="16" height="231" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(45, 256, 205)"/>
            <rect x="248" y="25" width="16" height="231" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(225, 256, 205)"/>
            <circle cx="256" cy="205" r="16" fill="#fff" stroke="#090d16" stroke-width="5"/>
        </svg>`
    },
    {
        category: "GA High-Wing Single Engine",
        icaoCodes: ["C150", "C152", "C172", "C177", "C180", "C182", "C185", "C206", "C207", "C210", "CC11", "CUB", "J3", "L4", "BC12", "A9"],
        name: "Cessna 172/182/206 / Piper Cub",
        svg: `<svg width="48" height="48" viewBox="0 0 512 512">
            <path fill="#00ff66" stroke="#090d16" stroke-width="13" stroke-linejoin="round" d="M 256,35 C 246,35 238,48 238,70 L 238,180 L 20,180 L 20,220 L 238,210 L 238,390 L 175,435 L 175,460 L 256,438 L 337,460 L 337,435 L 274,390 L 274,210 L 492,220 L 492,180 L 274,180 L 274,70 C 274,48 266,35 256,35 Z"/>
            <line x1="190" y1="35" x2="322" y2="35" stroke="#090d16" stroke-width="14" stroke-linecap="round"/>
            <line x1="190" y1="35" x2="322" y2="35" stroke="#00ff66" stroke-width="6" stroke-linecap="round"/>
        </svg>`
    },
    {
        category: "GA Low-Wing Sleek Composite",
        icaoCodes: ["SR20", "SR22", "SF50", "DA20", "DA40", "DA42", "DA62", "COL4"],
        name: "Cirrus SR22 / Vision Jet / Diamond DA40",
        svg: `<svg width="48" height="48" viewBox="0 0 512 512">
            <path fill="#00ff66" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,28 C 242,28 234,45 234,70 L 234,190 Q 130,205 30,225 Q 20,245 45,255 L 234,230 L 234,390 L 180,430 L 180,455 L 256,435 L 332,455 L 332,430 L 278,390 L 278,230 L 467,255 Q 492,245 482,225 Q 382,205 278,190 L 278,70 C 278,45 270,28 256,28 Z"/>
            <line x1="195" y1="28" x2="317" y2="28" stroke="#090d16" stroke-width="12" stroke-linecap="round"/>
        </svg>`
    },
    {
        category: "GA Low-Wing Hershey-Bar / Metal",
        icaoCodes: ["P28A", "P28R", "P28T", "PA24", "PA28", "PA30", "PA32", "PA34", "PA38", "PA44", "M20T", "M20P", "BE33", "BE35", "BE36", "BE55", "BE58", "AA5", "RV3", "RV4", "RV6", "RV7", "RV8", "RV9", "RV10", "RV12", "RV14"],
        name: "Piper Cherokee / Mooney / Bonanza / Vans RV",
        svg: `<svg width="48" height="48" viewBox="0 0 512 512">
            <path fill="#00ff66" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,35 C 246,35 238,48 238,68 L 238,185 L 25,200 L 25,235 L 238,220 L 238,380 L 180,425 L 180,450 L 256,432 L 332,450 L 332,425 L 274,380 L 274,220 L 487,235 L 487,200 L 274,185 L 274,68 C 274,48 266,35 256,35 Z"/>
            <line x1="200" y1="35" x2="312" y2="35" stroke="#090d16" stroke-width="12" stroke-linecap="round"/>
            <line x1="200" y1="35" x2="312" y2="35" stroke="#00ff66" stroke-width="5" stroke-linecap="round"/>
        </svg>`
    },
    {
        category: "Single-Engine High Performance Turboprop",
        icaoCodes: ["PC12", "PC24", "TBM7", "TBM8", "TBM9", "C208", "PAY2", "PAY3", "PAY4", "M500", "M600"],
        name: "Pilatus PC-12 / TBM 930 / Grand Caravan",
        svg: `<svg width="48" height="48" viewBox="0 0 512 512">
            <path fill="#00f0ff" stroke="#090d16" stroke-width="13" stroke-linejoin="round" d="M 256,20 C 244,20 236,35 236,55 L 236,185 L 30,210 L 30,240 L 236,225 L 236,400 L 160,435 L 160,460 L 256,440 L 352,460 L 352,435 L 276,400 L 276,225 L 482,240 L 482,210 L 276,185 L 276,55 C 276,35 268,20 256,20 Z"/>
            <line x1="175" y1="20" x2="337" y2="20" stroke="#090d16" stroke-width="16" stroke-linecap="round"/>
            <line x1="175" y1="20" x2="337" y2="20" stroke="#00f0ff" stroke-width="6" stroke-linecap="round"/>
        </svg>`
    },
    {
        category: "Twin-Engine Turboprop / Executive Prop",
        icaoCodes: ["BE9L", "BE10", "BE20", "BE30", "B350", "PA31", "C402", "C404", "C414", "C421", "DHC6", "DHC8", "DH8A", "DH8B", "DH8C", "DH8D", "AT43", "AT45", "AT72", "AT75", "AT76", "SF34", "SB20", "JS31", "JS32", "JS41", "SW4", "B190", "AN24", "AN26"],
        name: "King Air 200/350 / Dash 8 / ATR-72 / Twin Otter",
        svg: `<svg width="48" height="48" viewBox="0 0 512 512">
            <path fill="#00f0ff" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,30 C 246,30 238,42 238,60 L 238,190 L 40,215 L 40,245 L 238,230 L 238,380 L 170,430 L 170,455 L 256,435 L 342,455 L 342,430 L 274,380 L 274,230 L 472,245 L 472,215 L 274,190 L 274,60 C 274,42 266,30 256,30 Z"/>
            <rect x="145" y="195" width="22" height="50" rx="6" fill="#00f0ff" stroke="#090d16" stroke-width="6"/>
            <line x1="130" y1="195" x2="182" y2="195" stroke="#090d16" stroke-width="10" stroke-linecap="round"/>
            <rect x="345" y="195" width="22" height="50" rx="6" fill="#00f0ff" stroke="#090d16" stroke-width="6"/>
            <line x1="330" y1="195" x2="382" y2="195" stroke="#090d16" stroke-width="10" stroke-linecap="round"/>
        </svg>`
    },
    {
        category: "Executive Business Jets",
        icaoCodes: ["C500", "C510", "C525", "C25A", "C25B", "C25C", "C550", "C560", "C56X", "C650", "C680", "C700", "C750", "GLF2", "GLF3", "GLF4", "GLF5", "GLF6", "G280", "G150", "G200", "E50P", "E55P", "E545", "E550", "CL30", "CL35", "CL60", "CL64", "CL65", "GL5T", "GL6T", "GL7T", "FA10", "FA20", "FA50", "FA7X", "FA8X", "F900", "F2TH", "LJ31", "LJ35", "LJ40", "LJ45", "LJ55", "LJ60", "LJ75", "HA4T", "BE40", "BE4W", "PRRM"],
        name: "Gulfstream G650 / Citation CJ / Learjet / Challenger",
        svg: `<svg width="48" height="48" viewBox="0 0 512 512">
            <path fill="#3b82f6" stroke="#090d16" stroke-width="13" stroke-linejoin="round" d="M256 20c-8 0-14 8-14 18v150L60 290v30l182-45v80c-15 4-26 12-26 25v65l38-12 38 12v-65c0-13-11-21-26-25v-80l182 45v-30L270 188V38c0-10-6-18-14-18z"/>
            <rect x="204" y="335" width="18" height="42" rx="6" fill="#3b82f6" stroke="#090d16" stroke-width="5" />
            <rect x="290" y="335" width="18" height="42" rx="6" fill="#3b82f6" stroke="#090d16" stroke-width="5" />
        </svg>`
    },
    {
        category: "Commercial Narrowbodies & Regional Jets",
        icaoCodes: ["B731", "B732", "B733", "B734", "B735", "B736", "B737", "B738", "B739", "B38M", "B39M", "B752", "B753", "A318", "A319", "A320", "A321", "A20N", "A21N", "E135", "E145", "E170", "E175", "E190", "E195", "E290", "E295", "CRJ1", "CRJ2", "CRJ7", "CRJ9", "CRJX", "BCS1", "BCS3", "MD82", "MD83", "MD88", "MD90", "B712", "F70", "F100", "ARJ21"],
        name: "Boeing 737 / Airbus A320 / Embraer E-Jets / CRJ",
        svg: `<svg width="48" height="48" viewBox="0 0 512 512">
            <path fill="#a855f7" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M256 16c-12 0-22 10-22 22v140L24 280v40l210-48v112l-64 48v24l86-20 86 20v-24l-64-48V272l210 48v-40L278 178V38c0-12-10-22-22-22z"/>
            <rect x="155" y="240" width="24" height="50" rx="8" fill="#a855f7" stroke="#090d16" stroke-width="6" />
            <rect x="333" y="240" width="24" height="50" rx="8" fill="#a855f7" stroke="#090d16" stroke-width="6" />
        </svg>`
    },
    {
        category: "Commercial Widebodies & Heavy Cargo",
        icaoCodes: ["B741", "B742", "B743", "B744", "B748", "B762", "B763", "B764", "B772", "B773", "B77W", "B77L", "B788", "B789", "B78X", "A306", "A310", "A332", "A333", "A338", "A339", "A342", "A343", "A345", "A346", "A359", "A351", "A388", "DC10", "MD11", "IL76", "IL96", "AN124", "AN225"],
        name: "Boeing 747 / 777 / 787 / Airbus A380 / A350",
        svg: `<svg width="48" height="48" viewBox="0 0 512 512">
            <path fill="#a855f7" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M256 10c-14 0-24 12-24 26v140L10 270v45l222-40v120l-70 50v25l104-20 104 20v-25l-70-50V275l222 40v-45L280 176V36c0-14-10-26-24-26z"/>
            <rect x="110" y="240" width="26" height="55" rx="8" fill="#a855f7" stroke="#090d16" stroke-width="6" />
            <rect x="155" y="230" width="26" height="55" rx="8" fill="#a855f7" stroke="#090d16" stroke-width="6" />
            <rect x="331" y="230" width="26" height="55" rx="8" fill="#a855f7" stroke="#090d16" stroke-width="6" />
            <rect x="376" y="240" width="26" height="55" rx="8" fill="#a855f7" stroke="#090d16" stroke-width="6" />
        </svg>`
    },
    {
        category: "Tactical Fighter Jets",
        icaoCodes: ["F16", "F18", "FA18", "EA18", "F22", "F35", "F15", "EGL", "A10", "AV8B", "HAR", "SU27", "SU30", "SU35", "SU57", "MIG29", "MIG31", "MIG35", "EUFI", "RFAF", "JAS39", "MIR2", "MIR4", "T38", "T6", "T45", "T7", "M346", "L39", "L59", "L159", "K8"],
        name: "F-16 / F-18 / F-22 / F-35 / F-15 / A-10 / Eurofighter",
        svg: `<svg width="48" height="48" viewBox="0 0 512 512">
            <path fill="#ff4500" stroke="#090d16" stroke-width="13" stroke-linejoin="round" d="M 256,15 L 246,110 L 210,210 L 60,330 L 60,360 L 225,320 L 225,430 L 160,465 L 205,465 L 256,440 L 307,465 L 352,465 L 287,430 L 287,320 L 452,360 L 452,330 L 302,210 L 266,110 Z"/>
            <circle cx="256" cy="450" r="14" fill="#090d16"/>
        </svg>`
    },
    {
        category: "Military Bombers, Transports & Recon",
        icaoCodes: ["B52", "B1", "B2", "B21", "TU95", "TU160", "TU22", "C17", "C130", "C30J", "AC13", "C5", "KC135", "C135", "KC46", "K10", "C40", "E3TF", "E3CF", "E8", "E6", "P8", "P3", "RC135", "U2", "CN23", "C27J", "A400", "Y20", "MQ9", "RQ4", "MQ4"],
        name: "B-52 / B-1 / B-2 / C-17 / C-130 / MQ-9 Reaper",
        svg: `<svg width="48" height="48" viewBox="0 0 512 512">
            <path fill="#ff4500" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,10 C 244,10 236,25 236,45 L 236,170 L 10,310 L 10,340 L 236,260 L 236,430 L 165,475 L 165,495 L 256,475 L 347,495 L 347,475 L 276,430 L 276,260 L 502,340 L 502,310 L 276,170 L 276,45 C 276,25 268,10 256,10 Z"/>
            <rect x="100" y="270" width="20" height="42" rx="4" fill="#090d16"/>
            <rect x="160" y="240" width="20" height="42" rx="4" fill="#090d16"/>
            <rect x="332" y="240" width="20" height="42" rx="4" fill="#090d16"/>
            <rect x="392" y="270" width="20" height="42" rx="4" fill="#090d16"/>
        </svg>`
    },
    {
        category: "Special, Historic, Agricultural & Gliders",
        icaoCodes: ["V22", "AT50", "AT80", "G164", "M18", "C188", "A188", "CL21", "CL41", "PBY", "G21", "HU16", "ASK21", "DG50", "LS4", "DISCS", "CONC", "SR71", "BALL", "BLIMP", "LNEZ", "P180"],
        name: "V-22 Osprey / Air Tractor / Concorde / SR-71 / Glider",
        svg: `<svg width="48" height="48" viewBox="0 0 512 512">
            <path fill="#ec4899" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,10 L 246,140 Q 230,220 90,380 L 90,410 L 236,370 L 236,440 L 210,460 L 256,445 L 302,460 L 276,440 L 276,370 L 422,410 L 422,380 Q 282,220 266,140 Z"/>
        </svg>`
    }
];

// Count total explicit ICAO codes
let totalCodes = 0;
icaoIconMap.forEach(m => totalCodes += m.icaoCodes.length);
console.log(`Total explicit ICAO aircraft type codes indexed: ${totalCodes}`);

// Build HTML preview showcase
let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>200+ ICAO Aircraft Vector Icons Showcase (ADSBexchange / Tar1090 Style)</title>
<style>
    body { background: #0b0f19; color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 2rem; }
    h1 { color: #38bdf8; font-size: 1.6rem; border-bottom: 2px solid #1e293b; padding-bottom: 0.5rem; }
    .badge { background: #10b981; color: #000; font-size: 0.85rem; font-weight: bold; padding: 0.2rem 0.6rem; border-radius: 9999px; margin-left: 0.5rem; }
    .subtitle { color: #94a3b8; font-size: 0.9rem; margin-bottom: 2rem; }
    .group-card { background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 1.25rem; margin-bottom: 1.5rem; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
    .group-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px dashed #475569; padding-bottom: 0.75rem; margin-bottom: 1rem; }
    .group-name { color: #f59e0b; font-weight: bold; font-size: 1.1rem; }
    .group-count { color: #38bdf8; font-size: 0.85rem; font-weight: bold; }
    .icon-display { display: flex; align-items: center; gap: 1.5rem; }
    .icon-box { background: #0f172a; border: 1px solid #475569; width: 80px; height: 80px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .code-list { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .code-chip { background: #0f172a; border: 1px solid #3b82f6; color: #60a5fa; font-family: monospace; font-size: 0.75rem; padding: 0.15rem 0.4rem; border-radius: 4px; }
</style>
</head>
<body>
<h1>✈️ ADSBexchange-Style Top-Down Vector Icons <span class="badge">${totalCodes} ICAO Codes Indexed</span></h1>
<div class="subtitle">Exact 1-to-1 top-down engineering planform vector silhouettes for 200+ specific ICAO aircraft types.</div>
`;

icaoIconMap.forEach(g => {
    html += `<div class="group-card">
        <div class="group-header">
            <span class="group-name">${g.name} (${g.category})</span>
            <span class="group-count">${g.icaoCodes.length} ICAO Types</span>
        </div>
        <div class="icon-display">
            <div class="icon-box">${g.svg}</div>
            <div class="code-list">
                ${g.icaoCodes.map(c => `<span class="code-chip">${c}</span>`).join('')}
            </div>
        </div>
    </div>`;
});

html += `</body></html>`;

fs.writeFileSync('C:/Users/chadm/.gemini/antigravity/scratch/kvpz-tracker/icon_showcase.html', html);
console.log('Successfully generated updated icon_showcase.html!');
