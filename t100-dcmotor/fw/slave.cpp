// https://microchipdeveloper.com/32arm:samd21-sercom-i2c-slave-configuration

namespace atsamd::i2c {
class Slave {
  volatile target::sercom::Peripheral *sercom;

public:
public:
  int rxLength;
  int rxLimit;

  int txLength;

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

    sercom->I2CS.INTENSET = sercom->I2CS.INTENSET.bare().setDRDY(true).setAMATCH(true).setPREC(true);

    sercom->I2CS.CTRLB = sercom->I2CS.CTRLB.bare().setAACKEN(false).setSMEN(false);

    sercom->I2CS.ADDR = sercom->I2CS.ADDR.bare().setADDR(0x50).setADDRMASK(0);

    sercom->I2CS.CTRLA =
        sercom->I2CS.CTRLA.bare().setMODE(target::sercom::I2CS::CTRLA::MODE::I2C_SLAVE).setSCLSM(false).setENABLE(true);

    while (sercom->I2CS.SYNCBUSY)
      ;
  }

  const int CMD_END = 2;
  const int CMD_CONTINUE = 3;

  void interruptHandlerSERCOM() {

    target::sercom::I2CS::INTFLAG::Register flags = sercom->I2CS.INTFLAG.copy();
    target::sercom::I2CS::STATUS::Register status = sercom->I2CS.STATUS.copy();

    if (flags.getPREC()) {
      sercom->I2CS.INTFLAG.setPREC(true);
    }

    if (flags.getAMATCH()) {
      sercom->I2CS.CTRLB.setACKACT(0);
      sercom->I2CS.INTFLAG.setAMATCH(true);

      if (status.getDIR()) {
        // master read
        txLength = 0;
        txStart();
      } else {
        // master write
        rxLength = 0;
        rxStart();
      }
    }

    if (flags.getDRDY()) {

      if (status.getDIR()) {

        // master read
        if (txLength < txBufferSize) {
          sercom->I2CS.DATA = txBufferPtr[txLength++] | 0x80;
        } else {
          sercom->I2CS.DATA = 0xFF;
        }

      } else {

        // master write
        if (rxLength < rxBufferSize) {
          rxBufferPtr[rxLength++] = sercom->I2CS.DATA;
          sercom->I2CS.CTRLB.setACKACT(0).setCMD(CMD_CONTINUE);
        } else {
          sercom->I2CS.CTRLB.setACKACT(1).setCMD(CMD_END);
        }
      }
    }
  }

  virtual void rxStart(){};
  virtual void txStart(){};
};
} // namespace atsamd::i2c
