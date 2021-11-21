class Encoder {
  int pinA;
  int pinB;
  int extInA;

public:
  void init(int pinA, int pinB, int extInA) {

    this->pinA = pinA;
    this->pinB = pinB;
    this->extInA = extInA;

    target::PORT.OUTSET.setOUTSET(1 << pinA | 1 << pinB);
    target::PORT.PINCFG[pinA].setINEN(true).setPULLEN(true).setPMUXEN(true);
    target::PORT.PINCFG[pinB].setINEN(true).setPULLEN(true).setPMUXEN(true);

    if (pinA & 1) {
      target::PORT.PMUX[pinA >> 1].setPMUXO(target::port::PMUX::PMUXO::A);
    } else {
      target::PORT.PMUX[pinA >> 1].setPMUXE(target::port::PMUX::PMUXE::A);
    }

    target::GCLK.CLKCTRL = target::GCLK.CLKCTRL.bare()
                               .setID(target::gclk::CLKCTRL::ID::EIC)
                               .setGEN(target::gclk::CLKCTRL::GEN::GCLK0)
                               .setCLKEN(true);

    while (target::GCLK.STATUS.getSYNCBUSY())
      ;

    target::EIC.CTRL = target::EIC.CTRL.bare().setENABLE(true);
    while (target::EIC.STATUS)
      ;

    target::EIC.CONFIG.setSENSE(extInA, target::eic::CONFIG::SENSE::RISE);
    target::EIC.INTENSET.setEXTINT(extInA, true);
  }

  virtual void changed(int steps) = 0;

  void interruptHandlerEIC() {
    if (target::EIC.INTFLAG.getEXTINT(extInA)) {
      changed((target::PORT.IN.getIN() >> pinB) & 1 ? -1 : 1);
      target::EIC.INTFLAG.setEXTINT(extInA, true);
    }
  }
};
