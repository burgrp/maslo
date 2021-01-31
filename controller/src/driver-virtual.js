const Debug = require("debug");

module.exports = async ({ motors }) => {

    function now() {
        return new Date().getTime();
    }

    return {
        async createMotor(name, listener) {
            let log = Debug(`app:motor:${name}`);

            let stopCurrentMove;
            let pulseCounter = 0;
            let running = false;

            let lo = {};
            let hi = {};

            function stop() {
                log(`stop`);
                if (stopCurrentMove) {
                    stopCurrentMove();
                }
            }

            function checkStops() {

                let loStop = motors && motors[name] && motors[name].lo && pulseCounter <= motors[name].lo;
                if (loStop && !lo.stop) {
                    lo.pulses = pulseCounter;
                    stop();
                }
                lo.stop = loStop;

                let hiStop = motors && motors[name] && motors[name].lo && pulseCounter >= motors[name].hi;
                if (hiStop && !hi.stop) {
                    hi.pulses = pulseCounter;
                    stop();
                }
                hi.stop = hiStop;
            }

            checkStops();

            return {
                name,

                getState() {
                    return {
                        pulses: pulseCounter,
                        lo,
                        hi,
                        running
                    }
                },

                async move(pulses, timeMs) {

                    let ranToTheEnd = false;

                    if (!running && !(lo.stop && pulses < 0) && !(hi.stop && pulses > 0)) {

                        running = true;

                        log(`move ${pulses} pulses in ${timeMs} ms`);

                        let startedAtMs = now();
                        let startedPulses = pulseCounter;

                        function update() {
                            if (ranToTheEnd) {
                                pulseCounter = Math.round(startedPulses + pulses);
                            } else {
                                let actualTimeMs = now() - startedAtMs;
                                pulseCounter = startedPulses + Math.ceil(pulses * actualTimeMs / timeMs);
                            }

                            checkStops();

                            log(`pulses: ${pulseCounter}`);
                            listener();
                        }

                        let updateInterval = setInterval(update, 100);

                        try {

                            await new Promise((resolve, reject) => {
                                endTimeout = setTimeout(() => {
                                    clearInterval(updateInterval);
                                    ranToTheEnd = true;
                                    resolve();
                                }, timeMs);
                                stopCurrentMove = () => {
                                    clearInterval(updateInterval);
                                    resolve();
                                };
                            });

                        } finally {
                            running = false;
                            update();
                            log(`move finished`, pulseCounter);
                        }
                    }
                },

                stop
            }
        },

        async createRelay(name, listener) {
            let log = Debug(`app:relay:${name}`);

            let on = false;

            return {
                name,
                getState() {
                    return on;
                },
                async switch(newOn) {
                    log(`switch ${newOn ? "on" : "off"}`);
                    if (newOn !== on) {
                        on = newOn;
                        listener();
                    }
                }
            }
        }

    }

}