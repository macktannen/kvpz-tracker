function icaoToReg(icao) {
    const hex = parseInt(icao, 16);
    if (isNaN(hex) || hex < 0xA00001 || hex > 0xADFFFF) return null;
    
    const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // 24 letters
    const getLetters601 = (r) => {
        if (r === 0) return "";
        r -= 1;
        if (r < 24) return ALPHABET[r];
        r -= 24;
        return ALPHABET[Math.floor(r / 24)] + ALPHABET[r % 24];
    };
    
    let offset = hex - 0xA00001;
    let d1 = Math.floor(offset / 101711) + 1;
    let rem = offset % 101711;
    let prefix = "N" + d1;
    
    if (rem < 601) {
        return prefix + getLetters601(rem);
    }
    rem -= 601;
    
    if (rem < 6010) {
        let x = Math.floor(rem / 601);
        let r = rem % 601;
        return prefix + x + getLetters601(r);
    }
    rem -= 6010;
    
    if (rem < 60100) {
        let xx = Math.floor(rem / 601);
        let r = rem % 601;
        return prefix + xx.toString().padStart(2, '0') + getLetters601(r);
    }
    rem -= 60100;
    
    if (rem < 25000) {
        let xxx = Math.floor(rem / 25);
        let r = rem % 25;
        let suffix = r === 0 ? "" : ALPHABET[r - 1];
        return prefix + xxx.toString().padStart(3, '0') + suffix;
    }
    rem -= 25000;
    
    return prefix + rem.toString().padStart(4, '0');
}

console.log('A00001', icaoToReg('A00001')); // N1
console.log('A00002', icaoToReg('A00002')); // N1A
console.log('A0001B', icaoToReg('A0001B')); // N1AZ
console.log('A0001C', icaoToReg('A0001C')); // N1B
console.log('A00272', icaoToReg('A00272')); // N10
console.log('A03E5C', icaoToReg('A03E5C')); // Test user hex (N1164C)
console.log('A642E6', icaoToReg('A642E6')); // Another hex
