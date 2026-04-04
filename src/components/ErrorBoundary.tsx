/**
 * ErrorBoundary — Barrière d'erreur React.
 *
 * Capture les erreurs de rendu dans les composants enfants et affiche
 * un message d'erreur convivial au lieu d'un écran blanc.
 * Offre un bouton "Réessayer" pour relancer le rendu.
 *
 * Props :
 * - children   : Contenu protégé
 * - fallback   : Contenu de remplacement personnalisé (optionnel)
 * - section    : Nom de la section pour le message d'erreur
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  section?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.section ? ` - ${this.props.section}` : ''}]`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="rounded-2xl bg-destructive/10 border border-destructive/20 p-4 m-2">
          <p className="text-sm font-semibold text-destructive">
            Erreur dans {this.props.section || 'cette section'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {this.state.error?.message || 'Une erreur inattendue est survenue.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="text-xs text-primary underline mt-2"
          >
            Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
