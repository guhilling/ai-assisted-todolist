import panda from '../assets/paused-panda.svg'

type PausedProps = {
  /** The deployment's name for its environment, such as "QA"; null when it gives none. */
  environmentName: string | null
}

/**
 * What a visitor sees while the environment is down: its backend is switched off to save money,
 * and nothing is broken. Saying so -- with a panda that is clearly not in a hurry -- beats
 * "sign-in is not configured", which was true only in the narrowest sense.
 */
function Paused({ environmentName }: Readonly<PausedProps>) {
  return (
    <div className="signed-out">
      <h1 className="signed-out-title">TaskFest</h1>
      <img className="paused-panda" src={panda} alt="A cartoon panda chewing on bamboo" width={240} height={240} />
      <p className="paused-message">
        {environmentName ? `Environment ${environmentName}` : 'This environment'} is paused at the moment.
      </p>
    </div>
  )
}

export default Paused
