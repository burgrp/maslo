class PWM {
  volatile target::tc::Peripheral *tc;

public:
  void init(volatile target::tc::Peripheral *tc) {
    this->tc = tc;

    tc->COUNT8.CTRLA = tc->COUNT8.CTRLA.bare()
                            .setMODE(target::tc::COUNT8::CTRLA::MODE::COUNT8)
                            .setPRESCALER(target::tc::COUNT8::CTRLA::PRESCALER::DIV1)
                            .setWAVEGEN(target::tc::COUNT8::CTRLA::WAVEGEN::NPWM)
                            .setENABLE(true);

    while (tc->COUNT8.STATUS.getSYNCBUSY())
      ;

    // needs to be 0xFE to achieve full-on on CC=0xFF
    tc->COUNT8.PER.setPER(0xFE);
    tc->COUNT8.CC[0].setCC(0);
  }

  void set(unsigned int dc) {
    tc->COUNT8.CC[0].setCC(dc);
  }
};