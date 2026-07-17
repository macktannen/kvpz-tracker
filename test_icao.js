const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";

function icaoToReg(icao) {
    const hex = parseInt(icao, 16);
    if (isNaN(hex) || hex < 0xA00001 || hex > 0xADFFFF) return null;
    
    let offset = hex - 0xA00001;
    
    let d1 = Math.floor(offset / 101711) + 1;
    let rem = offset % 101711;
    let result = 'N' + d1;
    
    if (rem === 0) return result;
    rem -= 1;
    
    let d2 = Math.floor(rem / 10111);
    rem = rem % 10111;
    
    if (d2 < 10) {
        result += d2;
        if (rem === 0) return result;
        rem -= 1;
        
        let d3 = Math.floor(rem / 951);
        rem = rem % 951;
        
        if (d3 < 10) {
            result += d3;
            if (rem === 0) return result;
            rem -= 1;
            
            let d4 = Math.floor(rem / 35);
            rem = rem % 35;
            
            if (d4 < 10) {
                result += d4;
                if (rem === 0) return result;
                rem -= 1;
                result += ALPHABET[rem];
                return result;
            } else {
                result += ALPHABET[d4 - 10];
                if (rem === 0) return result;
                rem -= 1;
                result += ALPHABET[rem];
                return result;
            }
        } else {
            result += ALPHABET[d3 - 10];
            if (rem === 0) return result;
            rem -= 1;
            result += ALPHABET[rem];
            return result;
        }
    } else {
        result += ALPHABET[d2 - 10];
        if (rem === 0) return result;
        rem -= 1;
        result += ALPHABET[rem];
        return result;
    }
}

console.log(icaoToReg('A00001')); // N1
console.log(icaoToReg('A00002')); // N1A
console.log(icaoToReg('A00003')); // N1AA
console.log(icaoToReg('A0001B')); // N1AB
console.log(icaoToReg('A03E5C')); // Test the user's hex code
console.log(icaoToReg('A642E6')); // Another user hex code
