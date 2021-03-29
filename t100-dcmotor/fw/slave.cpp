namespace atsamd::i2c {
class Slave {
  volatile target::sercom::Peripheral *sercom;

public:
public:
  int rxLength;
  int rxLimit;

  int txLength;
  int txLimit;

  unsigned char *rxBufferPtr;
  unsigned int rxBufferSize;
  unsigned char *txBufferPtr;
  unsigned int txBufferSize;

  void init(int address, volatile target::sercom::Peripheral *sercom, unsigned char *rxBufferPtr,
            unsigned int rxBufferSize, unsigned char *txBufferPtr, unsigned int txBufferSize) {

    this->sercom = sercom;

    this->rxBufferPtr = rxBufferPtr;
    this->rxBufferSize = rxBufferSize;
    this->txBufferPtr = txBufferPtr;
    this->txBufferSize = txBufferSize;

    sercom->I2CS.INTENSET = sercom->I2CS.INTENSET.bare().setAMATCH(true).setDRDY(true); //.setPREC(true);

    sercom->I2CS.CTRLB = sercom->I2CS.CTRLB.bare().setAACKEN(false).setSMEN(false);

    sercom->I2CS.ADDR = sercom->I2CS.ADDR.bare().setADDR(0x50).setADDRMASK(0);

    sercom->I2CS.CTRLA =
        sercom->I2CS.CTRLA.bare().setMODE(target::sercom::I2CS::CTRLA::MODE::I2C_SLAVE).setSCLSM(false).setENABLE(true);

    while (sercom->I2CS.SYNCBUSY)
      ;
  }

  void interruptHandlerSERCOM() {

    if (sercom->I2CS.INTFLAG.getAMATCH()) {
      // sercom->I2CS.INTFLAG.setAMATCH(true);
      rxLength = 0;
      sercom->I2CS.DATA = rxLength++;
      sercom->I2CS.CTRLB.setCMD(3);
    }

    if (sercom->I2CS.INTFLAG.getDRDY()) {
      sercom->I2CS.DATA = rxLength++;
      sercom->I2CS.CTRLB.setCMD(3);
      // sercom->I2CS.INTFLAG.setDRDY(true);

      if (rxLength > 9) {
        sercom->I2CS.CTRLA.setENABLE(false);
        sercom->I2CS.CTRLA.setENABLE(true);
      }
    }

    if (sercom->I2CS.INTFLAG.getPREC()) {
      // sercom->I2CS.CTRLB.setCMD(2);
      sercom->I2CS.INTFLAG.setPREC(true);
    }


    // if (sercom->I2CS.INTFLAG.getMB()) {
    //   sercom->I2CS.INTFLAG.setMB(true);

    //   if (sercom->I2CS.STATUS.getBUSERR() || sercom->I2CS.STATUS.getRXNACK()) {

    //     if (sercom->I2CS.ADDR & 1) {
    //       rxComplete(rxLength);
    //     } else {
    //       txComplete(txLength);
    //     }

    //     sercom->I2CS.CTRLB.setCMD(3);

    //   } else {

    //     if (txLength < txLimit) {
    //       sercom->I2CS.DATA = txBufferPtr[txLength++];
    //     } else {
    //       txComplete(txLength);
    //       sercom->I2CS.CTRLB.setCMD(3);
    //     }

    //   }
    // }

    // if (sercom->I2CS.INTFLAG.getSB()) {
    //   sercom->I2CS.INTFLAG.setSB(true);

    //   if (rxLength < rxLimit && !sercom->I2CS.STATUS.getRXNACK()) {
    //     rxBufferPtr[rxLength] = sercom->I2CS.DATA;
    //     rxLength++;
    //     if (rxLength < rxLimit) {
    //       sercom->I2CS.CTRLB.setCMD(2);
    //     } else {
    //       rxComplete(rxLength);
    //       sercom->I2CS.CTRLB.setCMD(3);
    //     }
    //   } else {
    //     rxComplete(rxLength);
    //     sercom->I2CS.CTRLB.setCMD(3);
    //   }
    // }
  }

  virtual void rxComplete(int length){};
  virtual void txComplete(int length){};

  virtual void startRx(int address, int length) {
    rxLength = 0;
    rxLimit = length > rxBufferSize ? rxBufferSize : length;
    sercom->I2CS.ADDR.setADDR(address << 1 | 1);
  }

  virtual void startTx(int address, int length) {
    txLength = 0;
    txLimit = length > txBufferSize ? txBufferSize : length;
    sercom->I2CS.ADDR.setADDR(address << 1);
  }
};
} // namespace atsamd::i2c
