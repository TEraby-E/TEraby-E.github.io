#include <iostream>
#include <vector>
using namespace std;

struct Node {
    int prior, next;
};

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n, m;
    if (!(cin >> n >> m)) return 0;
    vector<Node> ring(n + 1);
    for (int i = 1; i <= n; ++i) {
        ring[i].prior = (i == 1 ? n : i - 1);
        ring[i].next = (i == n ? 1 : i + 1);
    }
    int p = 1;
    for (int left = n; left > 0; --left) {
        int steps = (m - 1) % left;
        while (steps--) p = ring[p].next;
        cout << p << (left == 1 ? '\n' : ' ');
        int before = ring[p].prior, after = ring[p].next;
        ring[before].next = after;
        ring[after].prior = before;
        p = after;
    }
}
