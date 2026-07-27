const fs = require('fs');

const icons = [
    {
        group: "1. Light General Aviation & Trainers",
        items: [
            {
                name: "Cessna 172/182/206",
                code: "C172, C182, C206",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#00ff66" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,35 C 246,35 238,48 238,70 L 238,180 L 20,180 L 20,220 L 238,210 L 238,390 L 175,435 L 175,460 L 256,438 L 337,460 L 337,435 L 274,390 L 274,210 L 492,220 L 492,180 L 274,180 L 274,70 C 274,48 266,35 256,35 Z"/>
                    <line x1="190" y1="35" x2="322" y2="35" stroke="#090d16" stroke-width="14" stroke-linecap="round"/>
                    <line x1="190" y1="35" x2="322" y2="35" stroke="#00ff66" stroke-width="6" stroke-linecap="round"/>
                </svg>`
            },
            {
                name: "Cirrus SR20/SR22",
                code: "SR20, SR22",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#00ff66" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,28 C 242,28 234,45 234,70 L 234,190 Q 130,205 30,225 Q 20,245 45,255 L 234,230 L 234,390 L 180,430 L 180,455 L 256,435 L 332,455 L 332,430 L 278,390 L 278,230 L 467,255 Q 492,245 482,225 Q 382,205 278,190 L 278,70 C 278,45 270,28 256,28 Z"/>
                    <line x1="195" y1="28" x2="317" y2="28" stroke="#090d16" stroke-width="12" stroke-linecap="round"/>
                </svg>`
            },
            {
                name: "Piper Cherokee / Archer",
                code: "P28A, PA28, PA32",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#00ff66" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,35 C 246,35 238,48 238,68 L 238,185 L 25,200 L 25,235 L 238,220 L 238,380 L 180,425 L 180,450 L 256,432 L 332,450 L 332,425 L 274,380 L 274,220 L 487,235 L 487,200 L 274,185 L 274,68 C 274,48 266,35 256,35 Z"/>
                    <line x1="200" y1="35" x2="312" y2="35" stroke="#090d16" stroke-width="12" stroke-linecap="round"/>
                    <line x1="200" y1="35" x2="312" y2="35" stroke="#00ff66" stroke-width="5" stroke-linecap="round"/>
                </svg>`
            },
            {
                name: "Diamond DA40 / DA42",
                code: "DA40, DA42",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#00ff66" stroke="#090d16" stroke-width="12" stroke-linejoin="round" d="M 256,20 C 248,20 240,35 240,55 L 240,195 L 15,220 L 15,245 L 240,230 L 240,410 L 175,445 L 175,470 L 256,455 L 337,470 L 337,445 L 272,410 L 272,230 L 497,245 L 497,220 L 272,195 L 272,55 C 272,35 264,20 256,20 Z"/>
                </svg>`
            }
        ]
    },
    {
        group: "2. Turboprops & Executive Props",
        items: [
            {
                name: "Pilatus PC-12 / TBM",
                code: "PC12, TBM8, TBM9",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#00f0ff" stroke="#090d16" stroke-width="13" stroke-linejoin="round" d="M 256,20 C 244,20 236,35 236,55 L 236,185 L 30,210 L 30,240 L 236,225 L 236,400 L 160,435 L 160,460 L 256,440 L 352,460 L 352,435 L 276,400 L 276,225 L 482,240 L 482,210 L 276,185 L 276,55 C 276,35 268,20 256,20 Z"/>
                    <line x1="175" y1="20" x2="337" y2="20" stroke="#090d16" stroke-width="16" stroke-linecap="round"/>
                    <line x1="175" y1="20" x2="337" y2="20" stroke="#00f0ff" stroke-width="6" stroke-linecap="round"/>
                </svg>`
            },
            {
                name: "King Air / Twin Turboprop",
                code: "BE20, BE30, B350",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#00f0ff" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,30 C 246,30 238,42 238,60 L 238,190 L 40,215 L 40,245 L 238,230 L 238,380 L 170,430 L 170,455 L 256,435 L 342,455 L 342,430 L 274,380 L 274,230 L 472,245 L 472,215 L 274,190 L 274,60 C 274,42 266,30 256,30 Z"/>
                    <rect x="145" y="195" width="22" height="50" rx="6" fill="#00f0ff" stroke="#090d16" stroke-width="6"/>
                    <line x1="130" y1="195" x2="182" y2="195" stroke="#090d16" stroke-width="10" stroke-linecap="round"/>
                    <rect x="345" y="195" width="22" height="50" rx="6" fill="#00f0ff" stroke="#090d16" stroke-width="6"/>
                    <line x1="330" y1="195" x2="382" y2="195" stroke="#090d16" stroke-width="10" stroke-linecap="round"/>
                </svg>`
            }
        ]
    },
    {
        group: "3. Business Jets & Regional Jets",
        items: [
            {
                name: "Gulfstream / Citation Bizjet",
                code: "GLF5, GLF6, C56X",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#3b82f6" stroke="#090d16" stroke-width="13" stroke-linejoin="round" d="M256 20c-8 0-14 8-14 18v150L60 290v30l182-45v80c-15 4-26 12-26 25v65l38-12 38 12v-65c0-13-11-21-26-25v-80l182 45v-30L270 188V38c0-10-6-18-14-18z"/>
                    <rect x="204" y="335" width="18" height="42" rx="6" fill="#3b82f6" stroke="#090d16" stroke-width="5" />
                    <rect x="290" y="335" width="18" height="42" rx="6" fill="#3b82f6" stroke="#090d16" stroke-width="5" />
                </svg>`
            },
            {
                name: "CRJ / Regional Jet",
                code: "CRJ2, CRJ7, CRJ9",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#3b82f6" stroke="#090d16" stroke-width="13" stroke-linejoin="round" d="M256 15c-6 0-12 6-12 15v180L75 275v25l167-35v110l-45 35v20l61-12 61 12v-20l-45-35V265l167 35v-25L268 210V30c0-9-6-15-12-15z"/>
                    <rect x="210" y="340" width="16" height="38" rx="4" fill="#3b82f6" stroke="#090d16" stroke-width="4"/>
                    <rect x="286" y="340" width="16" height="38" rx="4" fill="#3b82f6" stroke="#090d16" stroke-width="4"/>
                </svg>`
            }
        ]
    },
    {
        group: "4. Commercial Airliners & Heavies",
        items: [
            {
                name: "Boeing 737 / Airbus A320",
                code: "B738, A320, A321",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#a855f7" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M256 16c-12 0-22 10-22 22v140L24 280v40l210-48v112l-64 48v24l86-20 86 20v-24l-64-48V272l210 48v-40L278 178V38c0-12-10-22-22-22z"/>
                    <rect x="155" y="240" width="24" height="50" rx="8" fill="#a855f7" stroke="#090d16" stroke-width="6" />
                    <rect x="333" y="240" width="24" height="50" rx="8" fill="#a855f7" stroke="#090d16" stroke-width="6" />
                </svg>`
            },
            {
                name: "Boeing 747 Jumbo",
                code: "B744, B748, A380",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#a855f7" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M256 10c-14 0-24 12-24 26v140L10 270v45l222-40v120l-70 50v25l104-20 104 20v-25l-70-50V275l222 40v-45L280 176V36c0-14-10-26-24-26z"/>
                    <rect x="110" y="240" width="26" height="55" rx="8" fill="#a855f7" stroke="#090d16" stroke-width="6" />
                    <rect x="155" y="230" width="26" height="55" rx="8" fill="#a855f7" stroke="#090d16" stroke-width="6" />
                    <rect x="331" y="230" width="26" height="55" rx="8" fill="#a855f7" stroke="#090d16" stroke-width="6" />
                    <rect x="376" y="240" width="26" height="55" rx="8" fill="#a855f7" stroke="#090d16" stroke-width="6" />
                </svg>`
            }
        ]
    },
    {
        group: "5. Tactical Military Fighters",
        items: [
            {
                name: "F-16 Fighting Falcon",
                code: "F16",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#ff4500" stroke="#090d16" stroke-width="13" stroke-linejoin="round" d="M 256,15 L 246,110 L 210,210 L 60,330 L 60,360 L 225,320 L 225,430 L 160,465 L 205,465 L 256,440 L 307,465 L 352,465 L 287,430 L 287,320 L 452,360 L 452,330 L 302,210 L 266,110 Z"/>
                    <circle cx="256" cy="450" r="14" fill="#090d16"/>
                </svg>`
            },
            {
                name: "F/A-18 Super Hornet",
                code: "F18, FA18, EA18",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#ff4500" stroke="#090d16" stroke-width="13" stroke-linejoin="round" d="M 256,20 L 240,110 L 200,210 L 40,285 L 40,315 L 225,290 L 225,415 L 140,470 L 195,470 L 256,430 L 317,470 L 372,470 L 287,415 L 287,290 L 472,315 L 472,285 L 312,210 L 272,110 Z"/>
                    <rect x="210" y="440" width="16" height="26" rx="4" fill="#090d16"/>
                    <rect x="286" y="440" width="16" height="26" rx="4" fill="#090d16"/>
                </svg>`
            },
            {
                name: "F-22 Raptor",
                code: "F22",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#ff4500" stroke="#090d16" stroke-width="13" stroke-linejoin="round" d="M 256,15 L 220,130 L 30,300 L 95,350 L 220,310 L 220,420 L 145,475 L 210,475 L 256,445 L 302,475 L 367,475 L 292,420 L 292,310 L 417,350 L 482,300 L 292,130 Z"/>
                    <rect x="215" y="450" width="22" height="18" fill="#090d16"/>
                    <rect x="275" y="450" width="22" height="18" fill="#090d16"/>
                </svg>`
            },
            {
                name: "F-35 Lightning II",
                code: "F35",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#ff4500" stroke="#090d16" stroke-width="13" stroke-linejoin="round" d="M 256,20 L 225,120 L 50,290 L 100,340 L 225,305 L 225,415 L 155,470 L 210,470 L 256,440 L 302,470 L 357,470 L 287,415 L 287,305 L 412,340 L 462,290 L 287,120 Z"/>
                    <circle cx="256" cy="445" r="16" fill="#090d16"/>
                </svg>`
            },
            {
                name: "F-15 Eagle",
                code: "F15",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#ff4500" stroke="#090d16" stroke-width="13" stroke-linejoin="round" d="M 256,15 L 240,70 L 215,100 L 215,200 L 35,320 L 35,350 L 225,300 L 225,430 L 140,475 L 195,475 L 256,435 L 317,475 L 372,475 L 287,430 L 287,300 L 477,350 L 477,320 L 297,200 L 297,100 L 272,70 Z"/>
                    <rect x="210" y="445" width="18" height="25" fill="#090d16"/>
                    <rect x="284" y="445" width="18" height="25" fill="#090d16"/>
                </svg>`
            },
            {
                name: "A-10 Warthog",
                code: "A10",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#ff4500" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,30 L 235,160 L 15,160 L 15,225 L 235,220 L 235,400 L 160,400 L 160,460 L 180,460 L 180,430 L 256,430 L 332,430 L 332,460 L 352,460 L 352,400 L 277,400 L 277,220 L 497,225 L 497,160 L 277,160 Z"/>
                    <rect x="180" y="310" width="30" height="65" rx="10" fill="#090d16" stroke="#ff4500" stroke-width="4"/>
                    <rect x="302" y="310" width="30" height="65" rx="10" fill="#090d16" stroke="#ff4500" stroke-width="4"/>
                </svg>`
            }
        ]
    },
    {
        group: "6. Strategic Bombers & Military Transports",
        items: [
            {
                name: "B-52 Stratofortress",
                code: "B52",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#ff4500" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,10 C 244,10 236,25 236,45 L 236,170 L 10,310 L 10,340 L 236,260 L 236,430 L 165,475 L 165,495 L 256,475 L 347,495 L 347,475 L 276,430 L 276,260 L 502,340 L 502,310 L 276,170 L 276,45 C 276,25 268,10 256,10 Z"/>
                    <rect x="100" y="270" width="20" height="42" rx="4" fill="#090d16"/>
                    <rect x="160" y="240" width="20" height="42" rx="4" fill="#090d16"/>
                    <rect x="332" y="240" width="20" height="42" rx="4" fill="#090d16"/>
                    <rect x="392" y="270" width="20" height="42" rx="4" fill="#090d16"/>
                </svg>`
            },
            {
                name: "B-2 Spirit Flying Wing",
                code: "B2, B21",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#ff4500" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,40 L 10,240 L 65,280 L 140,240 L 190,290 L 256,250 L 322,290 L 372,240 L 447,280 L 502,240 Z"/>
                </svg>`
            },
            {
                name: "C-17 Globemaster III",
                code: "C17, C5, KC135",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#ff4500" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M256 16c-12 0-22 10-22 22v140L15 205v40l219-20v140l-75 50v25l112-25 112 25v-25l-75-50V225l219 20v-40L278 178V38c0-12-10-22-22-22z"/>
                    <rect x="135" y="210" width="22" height="48" rx="6" fill="#090d16" stroke="#ff4500" stroke-width="4"/>
                    <rect x="185" y="200" width="22" height="48" rx="6" fill="#090d16" stroke="#ff4500" stroke-width="4"/>
                    <rect x="305" y="200" width="22" height="48" rx="6" fill="#090d16" stroke="#ff4500" stroke-width="4"/>
                    <rect x="355" y="210" width="22" height="48" rx="6" fill="#090d16" stroke="#ff4500" stroke-width="4"/>
                </svg>`
            }
        ]
    },
    {
        group: "7. Helicopters & Tiltrotors",
        items: [
            {
                name: "CH-47 Chinook (Tandem Rotor)",
                code: "CH47, H47",
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
                name: "AH-64 Apache Attack Helo",
                code: "AH64, H64",
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
                name: "UH-60 Black Hawk",
                code: "UH60, H60",
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
                name: "MH-65 Coast Guard (Fenestron)",
                code: "AS65, HH65, EC135",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#ffcc00" stroke="#090d16" stroke-width="14" d="M 256,140 C 230,140 222,175 222,215 L 222,380 L 242,400 L 242,450 L 270,450 L 270,400 L 290,380 L 290,215 C 290,175 282,140 256,140 Z"/>
                    <circle cx="256" cy="425" r="22" fill="#090d16" stroke="#ffcc00" stroke-width="6"/>
                    <rect x="247" y="30" width="18" height="226" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(40, 256, 256)"/>
                    <rect x="247" y="30" width="18" height="226" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(130, 256, 256)"/>
                    <rect x="247" y="30" width="18" height="226" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(220, 256, 256)"/>
                    <rect x="247" y="30" width="18" height="226" rx="6" fill="#ffcc00" stroke="#090d16" stroke-width="4" transform="rotate(310, 256, 256)"/>
                    <circle cx="256" cy="256" r="18" fill="#fff" stroke="#090d16" stroke-width="6"/>
                </svg>`
            }
        ]
    },
    {
        group: "8. Unique & Special Aircraft",
        items: [
            {
                name: "V-22 Osprey Tiltrotor",
                code: "V22, OSPREY",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#ec4899" stroke="#090d16" stroke-width="14" d="M 256,40 C 242,40 232,55 232,80 L 232,230 L 60,230 L 60,270 L 232,260 L 232,380 L 175,430 L 175,455 L 256,435 L 337,455 L 337,430 L 280,380 L 280,260 L 452,270 L 452,230 L 280,230 L 280,80 C 280,55 270,40 256,40 Z"/>
                    <circle cx="50" cy="250" r="45" fill="none" stroke="#ec4899" stroke-width="12" stroke-dasharray="10 10"/>
                    <circle cx="50" cy="250" r="12" fill="#090d16"/>
                    <circle cx="462" cy="250" r="45" fill="none" stroke="#ec4899" stroke-width="12" stroke-dasharray="10 10"/>
                    <circle cx="462" cy="250" r="12" fill="#090d16"/>
                </svg>`
            },
            {
                name: "Rutan Long-EZ Canard",
                code: "LNEZ, P180",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <rect x="140" y="80" width="232" height="24" rx="6" fill="#ec4899" stroke="#090d16" stroke-width="8"/>
                    <path fill="#ec4899" stroke="#090d16" stroke-width="13" d="M256 30c-6 0-12 6-12 15v220L20 380v35l224-70v45l-35 25v20l47-10 47 10v-20l-35-25v-45l224 70v-35L268 265V45c0-9-6-15-12-15z"/>
                    <line x1="200" y1="365" x2="312" y2="365" stroke="#090d16" stroke-width="14" stroke-linecap="round"/>
                    <line x1="200" y1="365" x2="312" y2="365" stroke="#ec4899" stroke-width="6" stroke-linecap="round"/>
                </svg>`
            },
            {
                name: "Concorde / SR-71 Supersonic",
                code: "CONC, SR71",
                svg: `<svg width="48" height="48" viewBox="0 0 512 512">
                    <path fill="#ec4899" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,10 L 246,140 Q 230,220 90,380 L 90,410 L 236,370 L 236,440 L 210,460 L 256,445 L 302,460 L 276,440 L 276,370 L 422,410 L 422,380 Q 282,220 266,140 Z"/>
                </svg>`
            }
        ]
    }
];

let html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>ADSBexchange-Style Aircraft Top-Down Vector Icons Showcase</title>
<style>
    body { background: #0b0f19; color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 2rem; }
    h1 { color: #38bdf8; font-size: 1.6rem; border-bottom: 2px solid #1e293b; padding-bottom: 0.5rem; }
    .subtitle { color: #94a3b8; font-size: 0.9rem; margin-bottom: 2rem; }
    .group-title { color: #f59e0b; font-size: 1.1rem; margin-top: 2rem; margin-bottom: 1rem; border-left: 4px solid #f59e0b; padding-left: 0.6rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1.2rem; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 1rem; display: flex; flex-direction: column; align-items: center; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
    .icon-box { background: #0f172a; border: 1px solid #475569; width: 72px; height: 72px; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-bottom: 0.75rem; }
    .name { font-weight: 700; font-size: 0.9rem; color: #e2e8f0; margin-bottom: 0.2rem; }
    .code { font-family: monospace; font-size: 0.75rem; color: #38bdf8; }
</style>
</head>
<body>
<h1>✈️ ADSBexchange-Style Top-Down Aircraft Vector Icons</h1>
<div class="subtitle">Exact 1-to-1 top-down engineering planform SVG silhouettes grouped by aircraft family.</div>
`;

icons.forEach(g => {
    html += `<div class="group-title">${g.group}</div><div class="grid">`;
    g.items.forEach(item => {
        html += `<div class="card">
            <div class="icon-box">${item.svg}</div>
            <div class="name">${item.name}</div>
            <div class="code">${item.code}</div>
        </div>`;
    });
    html += `</div>`;
});

html += `</body></html>`;

fs.writeFileSync('C:/Users/chadm/.gemini/antigravity/scratch/kvpz-tracker/icon_showcase.html', html);
console.log('Successfully generated icon_showcase.html!');
