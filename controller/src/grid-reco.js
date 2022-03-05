module.exports = () => {
    
    return (image, size, debug) => {

        let t0 = new Date().getTime();
        
        let histograms = [];
    
        // allocate histograms
        for (let dir = 0; dir <= 1; dir++) {
            histograms[dir] = new Uint32Array(new ArrayBuffer(size * 4));
        }
    
        // count histograms sums
        for (let x = 0; x < size; x++) {
            for (let y = 0; y < size; y++) {
                v = image[x + size * y];
                histograms[0][x] += v;
                histograms[1][y] += v;
            }
        }
    
        // normalize to 0..100
        for (let dir = 0; dir <= 1; dir++) {
            
            let min;
            let max;
            for (let i = 0; i < size; i++) {
                let v = histograms[dir][i];
                if (min === undefined || min > v) {
                    min = v;
                }
                if (max === undefined || max < v) {
                    max = v;
                }
            }
    
            let sum = 0;
            for (let i = 0; i < size; i++) {
                histograms[dir][i] = max === min? 0: 100 * (histograms[dir][i] - min) / (max - min);
                sum += histograms[dir][i];
            }
            histograms[dir].avg = sum / size;
    
            // calculate histogram of histogram
            let hoh = new Uint32Array(new ArrayBuffer(101 * 4));
            for (let i = 0; i <= 100; i++) {
                hoh[histograms[dir][i]]++;
            }
            // identify empty image with noise only
            histograms[dir].clean = hoh.some(v => v > 15) && hoh[0] !== 101;
        }
    
        // identify flat histogram, find centers of maximum band if any 
        for (let dir = 0; dir <= 1; dir++) {
    
            let start;
            let stop;
    
            if (histograms[dir].clean && histograms[dir].avg < 70) {
    
                for (let i = 0; i < size; i++) {
                    let v = histograms[dir][i];
                    if (v > (histograms[dir].avg + 100) / 2) {
                        if (start === undefined) {
                            start = i;
                        }
                    } else {
                        if (start !== undefined && stop === undefined) {
                            stop = i;
                        }
                    }
                }
    
                let loSide = {
                    count: 0,
                    sum: 0
                };
                let hiSide = {
                    count: 0,
                    sum: 0
                };
    
                for (let i = 0; i < start - size / 10; i++) {
                    loSide.count++;
                    loSide.sum += histograms[dir][i];
                }
    
                for (let i = stop + size / 10; i < size; i++) {
                    hiSide.count++;
                    hiSide.sum += histograms[dir][i];
                }
    
                histograms[dir].peak = (start + stop) / 2;
    
                histograms[dir].sides = Math.sign(Math.round((
                    (loSide.count && loSide.sum / loSide.count) -
                    (hiSide.count && hiSide.sum / hiSide.count)
                ) / 3) * 3) + 1;
    
            }
        }
    
        let shapes = {
            0: ["northwest", "north", "northeast"],
            1: ["west", "cross", "east", "horizontal"],
            2: ["southwest", "south", "southeast"],
            3: [, "vertical"]
        }
    
        let result = {
            shape: shapes[histograms[1].sides === undefined ? 3 : histograms[1].sides][histograms[0].sides === undefined ? 3 : histograms[0].sides],
            center: Number.isFinite(histograms[0].peak) || Number.isFinite(histograms[1].peak) ? {
                x: Number.isFinite(histograms[0].peak) ? histograms[0].peak / size : 0.5,
                y: Number.isFinite(histograms[1].peak) ? histograms[1].peak / size : 0.5
            } : undefined
        }
    
        let t1 = new Date().getTime();
    
        if (debug) {
            result.debug = {
                timeMs: t1 - t0,
                shape: result.shape,
                center: result.center,
                histograms
            }
        }
    
        return result;
    }
    
}