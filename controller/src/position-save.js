module.exports = async ({ machine, configuration }) => {

    let xMm, yMm, zMm, timeout;

    function checkPositionChange() {
        let state = machine.getState();
        if (
            state.sled.position && (state.sled.position.xMm !== xMm || state.sled.position.yMm !== yMm) ||
            (state.spindle && state.spindle.zMm !== zMm)
        ) {
            if (timeout) {
                clearTimeout(timeout);
            }
            timeout = setTimeout(() => {
                timeout = null;
                state = machine.getState();

                xMm = state.sled.position && state.sled.position.xMm;
                yMm = state.sled.position && state.sled.position.yMm;
                zMm = state.spindle.zMm;

                configuration.data.lastPosition = { xMm, yMm, zMm };
                configuration.save().then(() => {
                    console.info("Position saved", xMm, yMm, zMm);
                    checkPositionChange();
                }).catch(e => {
                    console.info("Error saving configuration:", e);
                });


            }, 1000);

        }
    }

    machine.onStateChanged(checkPositionChange);

}