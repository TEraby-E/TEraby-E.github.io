#include <iostream>
#include <queue>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    if (!(cin >> n)) return 0;
    queue<int> track;
    int wanted = 1;
    for (int i = 0; i < n; ++i) {
        int x;
        cin >> x;
        if (x == wanted) ++wanted;
        else track.push(x);
        while (!track.empty() && track.front() == wanted) {
            track.pop();
            ++wanted;
        }
    }
    cout << (wanted == n + 1 ? "YES" : "NO") << '\n';
}
