//const logError = require("debug")("app:router:error");
const logInfo = require("debug")("app:router:info");

module.exports = ({moveLengthMm}) => {
    return {
        sweep(segments) {

            let t0 = new Date().getTime();  
    
            try {
    
                for (let { sweep, lengthMm, speedMmPerMin } of segments) {
    
                    let moveCount = ceil(lengthMm / moveLengthMm);
    
                    for (let posMm = 0; posMm <= lengthMm; posMm = posMm + lengthMm / moveCount) {
    
                        let { x: xMm, y: yMm } = sweep(posMm / lengthMm);
                        logInfo(`segment ${crdStr({ xMm, yMm })} ------------------------------------------------------`);
                       // await moveXY({ xMm, yMm, speedMmPerMin });
                    }
    
                }
    
                let t1 = new Date().getTime();
    
                let sMm = segments.reduce((acc, segment) => acc + segment.lengthMm, 0);
                let tSec = (t1 - t0) / 1000;
    
                logInfo(`run ${centRound(sMm)}mm took ${centRound(tSec)}s => ${round(60 * sMm / tSec)}mm/min`);
    
            } finally {
                //await stopAB();
            }
    
        }
    
    };
}