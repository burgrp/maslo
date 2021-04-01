class PWM {
  volatile target::tc::Peripheral *tc;

public:
  void init(volatile target::tc::Peripheral *tc, int pin) {
    this->tc = tc;

    tc->COUNT8.CTRLA = tc->COUNT8.CTRLA.bare()
                            .setMODE(target::tc::COUNT8::CTRLA::MODE::COUNT8)
                            .setPRESCALER(target::tc::COUNT8::CTRLA::PRESCALER::DIV2)
                            .setWAVEGEN(target::tc::COUNT8::CTRLA::WAVEGEN::NPWM)
                            .setENABLE(true);

    while (tc->COUNT8.STATUS.getSYNCBUSY())
      ;

    // needs to be 0xFE to achieve full-on on CC=0xFF
    tc->COUNT8.PER.setPER(0xFE);
    tc->COUNT8.CC[0].setCC(0);

    if (pin & 1) {
      target::PORT.PMUX[pin >> 1].setPMUXO(target::port::PMUX::PMUXO::E);
    } else {
      target::PORT.PMUX[pin >> 1].setPMUXE(target::port::PMUX::PMUXE::E);
    }

    target::PORT.PINCFG[pin].setPMUXEN(true);
  }

  void set(unsigned int dc) {
    tc->COUNT8.CC[0].setCC(dc);
  }
};
