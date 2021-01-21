module.exports = async ({}) => {
    return {
        client: __dirname + "/client",
        api: {
            controller: {
                version(neco) {
                    return("1.0");
                }
            }
        }
    }
}