class VNH7070 {

  int pinInA;
  int pinInB;

  PWM pwm;

public:
  void init(int pinInA, int pinInB, int pinPwm, int pinCs, volatile target::tc::Peripheral *tcPwm) {

    if (pinCs & 1) {
      target::PORT.PMUX[pinCs >> 1].setPMUXO(target::port::PMUX::PMUXO::B);
    } else {
      target::PORT.PMUX[pinCs >> 1].setPMUXE(target::port::PMUX::PMUXE::B);
    }

    target::ADC.CTRLB = target::ADC.CTRLB.bare().setRESSEL(target::adc::CTRLB::RESSEL::_8BIT);
    target::ADC.CALIB.setBIAS_CAL(target::NVMCALIB.SOFT1.getADC_BIASCAL());
    target::ADC.CALIB.setLINEARITY_CAL((target::NVMCALIB.SOFT1.getADC_LINEARITY_MSB() << 5) | target::NVMCALIB.SOFT0.getADC_LINEARITY_LSB());
    
    target::ADC.AVGCTRL.setSAMPLENUM(target::adc::AVGCTRL::SAMPLENUM::_1024_SAMPLES).setADJRES(4);
    target::ADC.INPUTCTRL.setMUXNEG(target::adc::INPUTCTRL::MUXNEG::GND)
        .setMUXPOS(target::adc::INPUTCTRL::MUXPOS::PIN0);
    target::ADC.REFCTRL.setREFSEL(target::adc::REFCTRL::REFSEL::INTVCC1);
    target::ADC.CTRLA = target::ADC.CTRLA.bare().setENABLE(true);

    while (target::ADC.STATUS)
      ;

    pwm.init(tcPwm, pinPwm);

    this->pinInA = pinInA;
    this->pinInB = pinInB;

    target::PORT.OUTCLR.setOUTCLR(1 << pinInA | 1 << pinInB);
    target::PORT.DIRSET.setDIRSET(1 << pinInA | 1 << pinInB);
  }

  void set(unsigned int speed, bool direction) {
    target::PORT.OUTCLR.setOUTCLR(1 << pinInA | 1 << pinInB);
    pwm.set(speed);
    //if (speed) {
      if (direction) {
        target::PORT.OUTSET.setOUTSET(1 << pinInB);
      } else {
        target::PORT.OUTSET.setOUTSET(1 << pinInA);
      }
    //}
  }

  int getCurrentmA() {
    target::ADC.SWTRIG.setSTART(true);
    while (!target::ADC.INTFLAG.getRESRDY())
      ;

    const int x = 1540 * 3300 / (2 * 1500);
    return (target::ADC.RESULT.getRESULT() * x) >> 8;
  }

};