const txt = "Position\nN41° 41’ 28.92” W86° 52’ 27.65”";
const match = txt.match(/([NS])\s*(\d+)[^\d]+(\d+)[^\d]+([\d\.]+)[^\dA-Z]+([EW])\s*(\d+)[^\d]+(\d+)[^\d]+([\d\.]+)/i);

console.log(match);
if (match) {
    const lat = parseInt(match[2]) + parseInt(match[3])/60 + parseFloat(match[4])/3600;
    const lon = parseInt(match[6]) + parseInt(match[7])/60 + parseFloat(match[8])/3600;
    console.log((match[1].toUpperCase() === 'S' ? -lat : lat), (match[5].toUpperCase() === 'W' ? -lon : lon));
}
