class Encoder {
  int pinA;
  int pinB;
  int extInA;
  int extInB;
  bool cancelNoise;

public:
  void init(int pinA, int pinB, int extInA, int extInB) {

    this->pinA = pinA;
    this->pinB = pinB;
    this->extInA = extInA;
    this->extInB = extInB;

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

    target::EIC.CONFIG.setSENSE(extInA, target::eic::CONFIG::SENSE::BOTH);
    target::EIC.CONFIG.setSENSE(extInB, target::eic::CONFIG::SENSE::BOTH);
    target::EIC.INTENSET.setEXTINT(extInA, true);
    target::EIC.INTENSET.setEXTINT(extInB, true);
  }

  virtual void changed(int steps) = 0;

  void interruptHandlerEIC() {
    if (target::EIC.INTFLAG.getEXTINT(extInA)) {
      if (!cancelNoise) {
        int in = target::PORT.IN.getIN();
        int a = (in >> pinA) & 1;
        int b = (in >> pinB) & 1;
        changed(a == b ? 1 : -1);        
      }
      cancelNoise = true;
      target::EIC.INTFLAG.setEXTINT(extInA, true);
    }

    if (target::EIC.INTFLAG.getEXTINT(extInB)) {
      cancelNoise = false;
      target::EIC.INTFLAG.setEXTINT(extInB, true);
    }
  }
};
