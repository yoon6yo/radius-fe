import { useParams } from 'react-router-dom';

export default function Room() {
  const { token } = useParams<{ token: string }>();

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold">룸: {token}</h2>
        <p className="text-sm text-gray-600">개발 중...</p>
      </div>
    </main>
  );
}
