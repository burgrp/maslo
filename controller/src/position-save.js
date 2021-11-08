module.exports = async ({ machine, configuration }) => {

    let xMm, yMm, zMm, timeout;

    function checkPositionChange() {
        let state = machine.getState();
        if (
            state.sledPosition && (state.sledPosition.xMm !== xMm || state.sledPosition.yMm !== yMm) ||
            (state.spindle && state.spindle.zMm !== zMm)
        ) {
            if (timeout) {
                clearTimeout(timeout);
            }
            timeout = setTimeout(() => {
                timeout = null;
                state = machine.getState();

                xMm = state.sledPosition && state.sledPosition.xMm;
                yMm = state.sledPosition && state.sledPosition.yMm;
                zMm = state.spindle && state.spindle.zMm;

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